/**
 * NarratorDialog - SpAIce chatbot dialog for planet narration
 * Triggered by N key or SpAIce button. Uses AIService directly.
 */
export class NarratorDialog {
    constructor(aiService = null) {
        this.aiService = aiService;
        this.isVisible = false;
        this.currentPlanet = null;
        this.typewriterInterval = null;
        this.chatHistory = [];

        this.createDialog();
        this.attachEventListeners();
    }

    createDialog() {
        this.container = document.createElement('div');
        this.container.id = 'narrator-dialog';
        this.container.className = 'narrator-dialog';

        this.container.innerHTML = `
            <div class="narrator-content">
                <div class="spaice-loading-overlay" id="spaice-loading">
                    <div class="spaice-loading-content">
                        <div class="chatbot-face-large">
                            <div class="face-inner">
                                <div class="eye eye-left"><div class="pupil"></div></div>
                                <div class="eye eye-right"><div class="pupil"></div></div>
                                <div class="mouth mouth-closed"><div class="mouth-line-closed"></div></div>
                                <div class="antenna"><div class="antenna-tip"></div></div>
                            </div>
                        </div>
                        <div class="loading-text">SpAIce is thinking...</div>
                        <div class="loading-dots"><span>.</span><span>.</span><span>.</span></div>
                    </div>
                </div>

                <div class="narrator-header">
                    <div class="chatbot-face-container">
                        <div class="chatbot-face" id="chatbot-face">
                            <div class="face-inner">
                                <div class="eye eye-left"><div class="pupil"></div></div>
                                <div class="eye eye-right"><div class="pupil"></div></div>
                                <div class="mouth"><div class="mouth-line"></div></div>
                                <div class="antenna"><div class="antenna-tip"></div></div>
                            </div>
                        </div>
                    </div>
                    <div class="narrator-info">
                        <div class="narrator-planet-name" id="narrator-planet-name">Planet Name</div>
                        <div class="narrator-subtitle">SpAIce - Your AI Guide</div>
                    </div>
                    <button class="narrator-close" id="narrator-close" title="Close (Esc)">&times;</button>
                </div>

                <div class="narrator-body">
                    <div class="narrator-narration-section">
                        <div class="narrator-text" id="narrator-text">Loading narration...</div>
                    </div>

                    <div class="narrator-chat-section" id="narrator-chat-section">
                        <div class="narrator-chat-header">
                            <span class="chat-header-icon">💬</span>
                            <span>Ask SpAIce about this planet</span>
                        </div>
                        <div class="narrator-chat-messages" id="narrator-chat-messages"></div>
                        <div class="narrator-chat-input-wrapper">
                            <input type="text" id="narrator-chat-input" class="narrator-chat-input"
                                placeholder="Ask SpAIce anything..." maxlength="200" />
                            <button class="narrator-chat-send" id="narrator-chat-send" title="Send (Enter)">
                                <span class="send-icon">➤</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="narrator-footer">
                    <button class="narrator-action-btn secondary" id="narrator-minimize">Minimize</button>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);

        this.elements = {
            planetName: document.getElementById('narrator-planet-name'),
            text: document.getElementById('narrator-text'),
            closeBtn: document.getElementById('narrator-close'),
            minimizeBtn: document.getElementById('narrator-minimize'),
            chatMessages: document.getElementById('narrator-chat-messages'),
            chatInput: document.getElementById('narrator-chat-input'),
            chatSend: document.getElementById('narrator-chat-send'),
            loadingOverlay: document.getElementById('spaice-loading')
        };
    }

    attachEventListeners() {
        this.elements.closeBtn.addEventListener('click', () => this.hide());
        this.elements.minimizeBtn.addEventListener('click', () => this.minimize());
        this.elements.chatSend.addEventListener('click', () => this.handleChatSend());

        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.handleChatSend();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) this.hide();
            if (this.isVisible && document.activeElement === this.elements.chatInput) {
                if (e.key !== 'Escape' && e.key !== 'Enter') e.stopPropagation();
            }
        });
    }

    showLoading() {
        this.elements.loadingOverlay.style.display = 'flex';
    }

    hideLoading() {
        this.elements.loadingOverlay.style.display = 'none';
    }

    async show(planet) {
        this.currentPlanet = planet;
        this.chatHistory = [];
        this.elements.chatMessages.innerHTML = '';

        if (this.aiService) {
            this.elements.chatInput.disabled = false;
            this.elements.chatSend.disabled = false;
            this.elements.chatInput.placeholder = `Ask SpAIce about ${planet.pl_name}...`;
        } else {
            this.elements.chatInput.disabled = true;
            this.elements.chatSend.disabled = true;
            this.elements.chatInput.placeholder = 'AI not configured';
        }

        this.elements.planetName.textContent = planet.pl_name || 'Unknown Planet';
        this.elements.text.textContent = '';

        this.container.classList.add('visible');
        this.container.classList.remove('minimized');
        this.isVisible = true;

        // Generate initial description
        if (this.aiService) {
            this.showLoading();
            try {
                const description = await this.aiService.generatePlanetDescription(planet);
                this.hideLoading();
                this.typewriterEffect(description);
            } catch (error) {
                this.hideLoading();
                this.elements.text.textContent = 'Could not generate description.';
            }
        } else {
            this.hideLoading();
            this.elements.text.textContent = `${planet.pl_name} — AI description not available.`;
        }
    }

    typewriterEffect(text, speed = 30) {
        let index = 0;
        this.elements.text.textContent = '';

        if (this.typewriterInterval) clearInterval(this.typewriterInterval);

        this.typewriterInterval = setInterval(() => {
            if (index < text.length) {
                this.elements.text.textContent += text.charAt(index);
                index++;
            } else {
                clearInterval(this.typewriterInterval);
                this.typewriterInterval = null;
            }
        }, speed);
    }

    hide() {
        this.container.classList.remove('visible');
        this.container.classList.remove('minimized');
        this.isVisible = false;

        if (this.typewriterInterval) {
            clearInterval(this.typewriterInterval);
            this.typewriterInterval = null;
        }

        this.hideLoading();
        this.currentPlanet = null;
        this.chatHistory = [];
        this.elements.chatMessages.innerHTML = '';
        this.elements.chatInput.value = '';
    }

    minimize() {
        this.container.classList.toggle('minimized');
    }

    async handleChatSend() {
        const message = this.elements.chatInput.value.trim();
        if (!message || !this.currentPlanet) return;

        this.elements.chatInput.value = '';
        this.addChatMessage('user', message);

        this.elements.chatInput.disabled = true;
        this.elements.chatSend.disabled = true;
        this.showLoading();

        try {
            // Use the same chatAboutPlanet method as PlanetExplorationDialog
            const response = await this.aiService.chatAboutPlanet(
                message,
                this.currentPlanet,
                this.chatHistory
            );

            this.chatHistory.push({ role: 'user', content: message });
            this.chatHistory.push({ role: 'assistant', content: response });

            this.hideLoading();
            this.elements.chatInput.disabled = false;
            this.elements.chatSend.disabled = false;
            this.addChatMessage('assistant', response);
        } catch (error) {
            this.hideLoading();
            this.elements.chatInput.disabled = false;
            this.elements.chatSend.disabled = false;
            this.addChatMessage('assistant', 'Sorry, I encountered an error. Please try again.');
        }

        this.elements.chatInput.focus();
    }

    addChatMessage(role, text) {
        const messageEl = document.createElement('div');
        messageEl.className = `narrator-chat-message ${role}`;

        const icon = role === 'user' ? '👤' : '🤖';
        messageEl.innerHTML = `
            <div class="message-icon">${icon}</div>
            <div class="message-text">${text}</div>
        `;

        this.elements.chatMessages.appendChild(messageEl);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    isShowing() {
        return this.isVisible;
    }
}
