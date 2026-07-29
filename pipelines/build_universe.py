#!/usr/bin/env python3
"""
build_universe.py — Single pipeline that produces all exoplanet data for the 3D frontend.

Sources:
  - NASA Exoplanet Archive (pscomppars table) → clustered JSON files

Coordinate system:
  - Heliocentric J2000 Equatorial (ICRS)
  - Cartesian x, y, z in light-years
  - Compatible with astronomy-engine (solar system) and HYG (stars)

Usage:
  python pipelines/build_universe.py
"""

import json
import math
import os
import sys
from datetime import date

import numpy as np
import numpy.ma as ma

try:
    from astroquery.ipac.nexsci.nasa_exoplanet_archive import NasaExoplanetArchive
except ImportError:
    print("ERROR: astroquery not installed. Run: pip install astroquery")
    sys.exit(1)

# ─── Configuration ───────────────────────────────────────────────────

COLUMNS = [
    "pl_name", "hostname", "sy_dist", "ra", "dec",
    "pl_rade", "pl_bmasse", "pl_eqt", "pl_orbper", "pl_orbsmax",
    "discoverymethod", "disc_year",
    "st_teff", "st_rad", "st_mass", "st_spectype",
]

# Use pscomppars: one row per planet, composite best values, ~5800 rows
TABLE = "pscomppars"

PARSEC_TO_LY = 3.26156

DISTANCE_TIERS = [
    ("nearby",  0,    100),
    ("medium",  100,  500),
    ("far",     500,  2000),
    ("veryfar", 2000, float("inf")),
]

QUADRANTS = [
    (1, 0,   90),
    (2, 90,  180),
    (3, 180, 270),
    (4, 270, 360),
]

MAX_CLUSTER_BYTES = 20 * 1024 * 1024  # 20 MB per file

OUTPUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "nasa_data", "clusters",
)

# ─── Helpers ─────────────────────────────────────────────────────────


def safe_value(val):
    """Extract a raw Python scalar from an astropy Quantity / masked value."""
    if ma.is_masked(val):
        return None
    try:
        v = val.value
    except AttributeError:
        v = val
    if isinstance(v, (np.ndarray, ma.MaskedArray)):
        if v.ndim == 0:
            v = v.item()
        else:
            return None
    if isinstance(v, (np.integer, int)) and not isinstance(v, bool):
        return int(v)
    if isinstance(v, (np.floating, float)):
        fv = float(v)
        if math.isnan(fv) or math.isinf(fv):
            return None
        return round(fv, 6)
    if isinstance(v, (np.str_, np.bytes_, bytes)):
        return str(v)
    return v


def to_cartesian_ly(ra_deg, dec_deg, dist_pc):
    """
    Spherical (RA/Dec/Distance) → Cartesian (x, y, z) in light-years.

    Frame: Heliocentric J2000 Equatorial (ICRS)
      +X → Vernal Equinox (RA=0, Dec=0)
      +Y → RA=90°, Dec=0
      +Z → Celestial North Pole (Dec=+90°)
    """
    dist_ly = dist_pc * PARSEC_TO_LY
    ra_rad = math.radians(ra_deg)
    dec_rad = math.radians(dec_deg)

    x = dist_ly * math.cos(dec_rad) * math.cos(ra_rad)
    y = dist_ly * math.cos(dec_rad) * math.sin(ra_rad)
    z = dist_ly * math.sin(dec_rad)

    return round(x, 2), round(y, 2), round(z, 2), round(dist_ly, 2)


def classify_planet(pl_rade, pl_eqt, pl_bmasse):
    """Derive characteristics from physical properties."""
    r = pl_rade or 1.0
    t = pl_eqt or 288
    m = pl_bmasse or 1.0

    # Size classification
    if r < 0.8:
        radius_pos = "Sub-Earth"
    elif r <= 1.25:
        radius_pos = "Earth-like"
    elif r < 2.0:
        radius_pos = "Super-Earth"
    elif r < 4.0:
        radius_pos = "Mini-Neptune"
    elif r < 6.0:
        radius_pos = "Neptune-like"
    elif r < 10.0:
        radius_pos = "Sub-Jupiter"
    elif r < 14.0:
        radius_pos = "Jupiter-like"
    else:
        radius_pos = "Super-Jupiter"

    # Atmosphere
    if r < 0.5:
        atmo = "None (Exosphere)"
    elif r > 6:
        atmo = "H2-He (Dense Gas Giant)"
    elif r > 3:
        atmo = "H2-He-CH4 (Ice Giant)"
    elif t > 700:
        atmo = "CO2-SO2 (Hot Dense)"
    elif 200 <= t <= 350 and r <= 2:
        atmo = "N2-O2 (Potentially Breathable)"
    elif t < 200:
        atmo = "N2-CH4 (Cold Thin)"
    else:
        atmo = "CO2-N2 (Dense)"

    # Material
    if r > 6:
        material = "Gas (Hydrogen/Helium)"
    elif r > 3:
        material = "Ice/Gas (Water/Ammonia/Methane)"
    elif t > 1000:
        material = "Rocky (Iron/Silicates - Molten)"
    elif 200 <= t <= 350:
        material = "Rocky (Silicates/Iron/Water)"
    else:
        material = "Rocky (Silicates)"

    # Habitability
    hab = 0
    if 200 <= t <= 350 and 0.5 <= r <= 2.0:
        hab = 50
        if 250 <= t <= 310:
            hab += 20
        if 0.8 <= r <= 1.5:
            hab += 15
        if 0.5 <= m <= 3.0:
            hab += 15
        hab = min(hab, 100)
    elif 200 <= t <= 400 and r <= 3.0:
        hab = 15

    tox = 10 if hab > 70 else (40 if hab > 30 else (100 if (t > 700 or t < 100) else 80))

    # Orbit type
    sma = None  # will be set from pl_orbsmax
    orbit = None

    return {
        "radius_position": radius_pos,
        "atmosphere_type": atmo,
        "principal_material": material,
        "habitability_percent": hab,
        "toxicity_percent": tox,
    }


def enrich(planet):
    """Add characteristics and orbit_type to a planet dict."""
    chars = classify_planet(
        planet.get("pl_rade"),
        planet.get("pl_eqt"),
        planet.get("pl_bmasse"),
    )

    sma = planet.get("pl_orbsmax")
    if sma is not None:
        if sma < 0.1:
            chars["orbit_type"] = "Ultra-short - Scorching Zone"
        elif sma < 0.5:
            chars["orbit_type"] = "Circular - Hot Zone"
        elif sma < 1.5:
            chars["orbit_type"] = "Circular - Habitable Zone"
        elif sma < 5:
            chars["orbit_type"] = "Circular - Cold Zone"
        else:
            chars["orbit_type"] = "Wide - Frozen Zone"

    planet["characteristics"] = chars
    return planet


def assign_bucket(planet):
    """Return (tier_name, quadrant_number) based on dist_ly and ra."""
    dist = planet.get("dist_ly")
    ra = planet.get("ra")
    if dist is None or ra is None:
        return None, None

    tier = None
    for name, lo, hi in DISTANCE_TIERS:
        if lo <= dist < hi:
            tier = name
            break

    quad = None
    for q, lo, hi in QUADRANTS:
        if lo <= ra < hi:
            quad = q
            break
    if quad is None and ra >= 360:
        quad = 4

    return tier, quad


def write_cluster(filepath, planets):
    """Write a cluster JSON file; split into _a/_b if > 20 MB."""
    data = json.dumps(planets, separators=(",", ":"))
    if len(data.encode()) <= MAX_CLUSTER_BYTES:
        with open(filepath, "w") as f:
            f.write(data)
        return [filepath]

    mid = len(planets) // 2
    base, ext = os.path.splitext(filepath)
    parts = []
    for suffix, chunk in [("_a", planets[:mid]), ("_b", planets[mid:])]:
        part_path = f"{base}{suffix}{ext}"
        with open(part_path, "w") as f:
            json.dump(chunk, f, separators=(",", ":"))
        parts.append(part_path)
    return parts


# ─── Main ────────────────────────────────────────────────────────────


def main():
    print("=" * 60)
    print("  build_universe.py — Exoplanet Data Pipeline")
    print("=" * 60)

    # 1. Query NASA Exoplanet Archive
    print(f"\n[1/4] Querying NASA Exoplanet Archive ({TABLE} table)...")
    result = NasaExoplanetArchive.query_criteria(
        table=TABLE,
        select=",".join(COLUMNS),
    )
    print(f"      Fetched {len(result)} planets.")

    # 2. Convert to dicts, compute cartesian, enrich
    print("[2/4] Computing 3D coordinates and enriching...")
    planets_with_pos = []
    planets_no_pos = []

    for row in result:
        d = {}
        for col in COLUMNS:
            d[col] = safe_value(row[col])

        ra = d.get("ra")
        dec = d.get("dec")
        dist = d.get("sy_dist")

        if ra is not None and dec is not None and dist is not None and dist > 0:
            x, y, z, dist_ly = to_cartesian_ly(ra, dec, dist)
            d["x_ly"] = x
            d["y_ly"] = y
            d["z_ly"] = z
            d["dist_ly"] = dist_ly
            d = enrich(d)
            planets_with_pos.append(d)
        else:
            d = enrich(d)
            planets_no_pos.append(d)

    print(f"      {len(planets_with_pos)} with valid positions, {len(planets_no_pos)} without.")

    # 3. Cluster spatially
    print("[3/4] Assigning planets to distance/quadrant clusters...")
    buckets = {}
    unassigned = 0
    for p in planets_with_pos:
        tier, quad = assign_bucket(p)
        if tier is None or quad is None:
            unassigned += 1
            continue
        key = f"{tier}_quad{quad}"
        buckets.setdefault(key, []).append(p)

    # 4. Write output
    print("[4/4] Writing cluster files...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Clean old cluster files
    for f in os.listdir(OUTPUT_DIR):
        if f.endswith(".json"):
            os.remove(os.path.join(OUTPUT_DIR, f))

    cluster_meta = {}
    total_exported = 0

    for key in sorted(buckets):
        filepath = os.path.join(OUTPUT_DIR, f"{key}.json")
        written_files = write_cluster(filepath, buckets[key])
        count = len(buckets[key])
        total_exported += count

        if len(written_files) == 1:
            cluster_meta[key] = {
                "filename": os.path.basename(written_files[0]),
                "planet_count": count,
            }
        else:
            mid = count // 2
            for i, wf in enumerate(written_files):
                part_key = f"{key}_{chr(ord('a') + i)}"
                part_count = mid if i == 0 else count - mid
                cluster_meta[part_key] = {
                    "filename": os.path.basename(wf),
                    "planet_count": part_count,
                }
            if os.path.exists(filepath):
                os.remove(filepath)

    # Write no_position cluster
    if planets_no_pos:
        no_pos_path = os.path.join(OUTPUT_DIR, "no_position.json")
        with open(no_pos_path, "w") as f:
            json.dump(planets_no_pos, f, separators=(",", ":"))
        cluster_meta["no_position"] = {
            "filename": "no_position.json",
            "planet_count": len(planets_no_pos),
        }

    # Write cluster_index.json
    index = {
        "total_planets": total_exported,
        "total_clusters": len(cluster_meta),
        "generated_date": date.today().isoformat(),
        "coordinate_system": "Heliocentric J2000 Equatorial (ICRS), Cartesian, light-years",
        "position_fields": "x_ly, y_ly, z_ly (light-years from Sun)",
        "clusters": cluster_meta,
    }
    index_path = os.path.join(OUTPUT_DIR, "cluster_index.json")
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2)

    # Summary
    print("\n" + "=" * 60)
    print("  DONE")
    print("=" * 60)
    print(f"  Source table:       {TABLE}")
    print(f"  Total from NASA:   {len(result)}")
    print(f"  With positions:    {len(planets_with_pos)}")
    print(f"  Without positions: {len(planets_no_pos)}")
    print(f"  Exported:          {total_exported}")
    print(f"  Clusters:          {len(cluster_meta)}")
    print()
    for key in sorted(cluster_meta):
        m = cluster_meta[key]
        print(f"    {m['filename']:30s}  {m['planet_count']:>6,} planets")
    print()
    print(f"  Output: {OUTPUT_DIR}")
    print(f"  Coordinate system: Heliocentric J2000 Equatorial (ICRS)")
    print(f"  Units: light-years (x_ly, y_ly, z_ly)")
    print("=" * 60)


if __name__ == "__main__":
    main()
