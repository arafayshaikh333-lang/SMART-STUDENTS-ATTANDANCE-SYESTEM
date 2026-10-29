const SYSTEM_INSTRUCTION = `You are Astra Gemini AI, a friendly, brilliant, all-knowing AI assistant just like Google Gemini.
- Answer every question accurately across science, coding, history, current affairs, daily life, business, and education.
- Automatically match the user's language: if the user writes in Roman Urdu, reply naturally in clear Roman Urdu; if Urdu script, reply in Urdu; if English, reply in English.
- Structure answers clearly using Markdown headings, bullet points, code blocks, and tables when helpful.`;

let apiKey = localStorage.getItem('ASTRA_GEMINI_API_KEY') || '';
let conversations = JSON.parse(localStorage.getItem('ASTRA_CHATS') || '[]');
let activeChatId = null;
let attachedImageBase64 = null;
let attachedImageMime = null;

const chatContainer = document.getElementById('chatContainer');
const welcomeScreen = document.getElementById('welcomeScreen');
const messagesList = document.getElementById('messagesList');
const chatForm = document.getElementById('chatForm');
const userInput = document.getElementById('userInput');
const webSearchToggle = document.getElementById('webSearchToggle');
const autoSpeakToggle = document.getElementById('autoSpeakToggle');
const chatHistoryList = document.getElementById('chatHistoryList');
const apiModal = document.getElementById('apiModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const apiKeyStatusBadge = document.getElementById('apiKeyStatusBadge');

function init() {
  updateApiBadge();
  renderChatHistory();
  if (conversations.length > 0) { loadChat(conversations[0].id); }
}

function updateApiBadge() {
  if (apiKey && apiKey.startsWith('AIza')) {
    apiKeyStatusBadge.textContent = 'Connected';
    apiKeyStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300';
  } else {
    apiKeyStatusBadge.textContent = 'Set Key';
    apiKeyStatusBadge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300';
  }
}

function createNewChat() {
  activeChatId = Date.now().toString();
  conversations.unshift({ id: activeChatId, title: 'New Chat', messages: [] });
  saveChats();
  renderChatHistory();
  renderMessages();
}

function loadChat(chatId) {
  activeChatId = chatId;
  renderChatHistory();
  renderMessages();
}

function saveChats() { localStorage.setItem('ASTRA_CHATS', JSON.stringify(conversations)); }

function renderChatHistory() {
  chatHistoryList.innerHTML = '';
  conversations.forEach(chat => {
    const btn = document.createElement('button');
    const isActive = chat.id === activeChatId;
    btn.className = `w-full text-left px-3 py-2 rounded-lg text-xs truncate flex items-center gap-2 transition ${isActive ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`;
    btn.innerHTML = `<i class="fa-regular fa-message"></i> <span class="truncate">${chat.title}</span>`;
    btn.onclick = () => loadChat(chat.id);
    chatHistoryList.appendChild(btn);
  });
}

function renderMessages() {
  const currentChat = conversations.find(c => c.id === activeChatId);
  messagesList.innerHTML = '';
  if (!currentChat || currentChat.messages.length === 0) {
    welcomeScreen.classList.remove('hidden');
    return;
  }
  welcomeScreen.classList.add('hidden');
  currentChat.messages.forEach(msg => appendMessageToDOM(msg.role, msg.text, msg.image, msg.sources));
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function appendMessageToDOM(role, text, image = null, sources = []) {
  welcomeScreen.classList.add('hidden');
  const wrapper = document.createElement('div');
  wrapper.className = `flex gap-3 ${role === 'user' ? 'justify-end' : 'justify-start'}`;

  if (role === 'user') {
    wrapper.innerHTML = `
      <div class="max-w-[82%] bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 shadow-lg">
        ${image ? `<img src="${image}" class="max-h-48 rounded-lg mb-2 border border-white/20" />` : ''}
        <p class="text-sm whitespace-pre-wrap">${escapeHtml(text)}</p>
      </div>`;
  } else {
    const htmlContent = marked.parse(text || '');
    let sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = `<div class="mt-3 pt-2 border-t border-slate-700/60 flex flex-wrap gap-1.5">
        <span class="text-[10px] text-slate-400 w-full mb-0.5"><i class="fa-brands fa-google text-blue-400 mr-1"></i>Verified Sources:</span>
        ${sources.map(s => `<a href="${s.uri}" target="_blank" class="text-[11px] bg-slate-800 hover:bg-slate-700 text-indigo-300 px-2 py-0.5 rounded-md truncate max-w-[200px]">${s.title || s.uri}</a>`).join('')}
      </div>`;
    }

    wrapper.innerHTML = `
      <div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-pink-500 flex-shrink-0 flex items-center justify-center shadow-md mt-1"><i class="fa-solid fa-sparkles text-xs text-white"></i></div>
      <div class="max-w-[85%] bg-slate-900/90 border border-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 shadow-md">
        <div class="prose-custom text-sm text-slate-200">${htmlContent}</div>
        ${sourcesHtml}
        <div class="flex items-center gap-3 mt-2 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
          <button class="speak-btn hover:text-indigo-400 flex items-center gap-1"><i class="fa-solid fa-volume-high"></i> Listen</button>
          <button class="copy-btn hover:text-indigo-400 flex items-center gap-1"><i class="fa-regular fa-copy"></i> Copy</button>
        </div>
      </div>`;

    wrapper.querySelector('.speak-btn').onclick = () => speakText(text);
    const copyBtn = wrapper.querySelector('.copy-btn');
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(text);
      copyBtn.innerHTML = '<i class="fa-solid fa-check text-emerald-400"></i> Copied';
      setTimeout(() => (copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy'), 1500);
    };
  }
  messagesList.appendChild(wrapper);
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

async function sendMessage(promptText) {
  if (!apiKey) {
    apiModal.classList.remove('hidden');
    apiModal.classList.add('flex');
    return;
  }
  if (!activeChatId) createNewChat();
  const currentChat = conversations.find(c => c.id === activeChatId);
  const userImgDataUrl = attachedImageBase64 ? `data:${attachedImageMime};base64,${attachedImageBase64}` : null;
  appendMessageToDOM('user', promptText, userImgDataUrl);

  if (currentChat.messages.length === 0) {
    currentChat.title = promptText.slice(0, 34) + (promptText.length > 34 ? '...' : '');
  }

  currentChat.messages.push({ role: 'user', text: promptText, image: userImgDataUrl });
  saveChats();
  renderChatHistory();

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'flex items-center gap-3 text-slate-400 text-xs';
  loadingDiv.innerHTML = `<div class="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center"><i class="fa-solid fa-spinner fa-spin text-white text-xs"></i></div><span>Astra Gemini AI soch raha hai...</span>`;
  messagesList.appendChild(loadingDiv);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const contents = currentChat.messages.map(m => {
      const parts = [{ text: m.text }];
      if (m.image && m === currentChat.messages[currentChat.messages.length - 1] && attachedImageBase64) {
        parts.push({ inline_data: { mime_type: attachedImageMime, data: attachedImageBase64 } });
      }
      return { role: m.role === 'user' ? 'user' : 'model', parts };
    });

    clearImageAttachment();
    const bodyPayload = { system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] }, contents };
    if (webSearchToggle.checked) { bodyPayload.tools = [{ google_search: {} }]; }

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload)
    });
    const data = await res.json();
    loadingDiv.remove();

    if (data.error) {
      appendMessageToDOM('assistant', `**API Error:** ${data.error.message}`);
      return;
    }

    const candidate = data.candidates?.[0];
    const replyText = candidate?.content?.parts?.map(p => p.text || '').join('') || 'Maaf kijiyega, jawab hasil nahi ho saka.';
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const sources = chunks.filter(c => c.web).map(c => ({ uri: c.web.uri, title: c.web.title }));

    currentChat.messages.push({ role: 'assistant', text: replyText, sources });
    saveChats();
    appendMessageToDOM('assistant', replyText, null, sources);
    if (autoSpeakToggle.checked) { speakText(replyText); }
  } catch (err) {
    loadingDiv.remove();
    appendMessageToDOM('assistant', `**Network Error:** ${err.message}`);
  }
}

const micBtn = document.getElementById('micBtn');
const voiceLangSelect = document.getElementById('voiceLangSelect');
let recognition = null;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.onstart = () => micBtn.classList.add('mic-recording');
  recognition.onend = () => micBtn.classList.remove('mic-recording');
  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = transcript;
    sendMessage(transcript);
    userInput.value = '';
  };
}
micBtn.onclick = () => {
  if (!recognition) { alert('Aapka browser Voice Mic support nahi karta.'); return; }
  recognition.lang = voiceLangSelect.value;
  recognition.start();
};

function speakText(rawText) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const cleanText = rawText.replace(/[#*_`~>-]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = voiceLangSelect.value;
  window.speechSynthesis.speak(utterance);
}

const uploadImgBtn = document.getElementById('uploadImgBtn');
const imageInput = document.getElementById('imageInput');
const imagePreviewBar = document.getElementById('imagePreviewBar');
const previewImg = document.getElementById('previewImg');
const previewImgName = document.getElementById('previewImgName');

uploadImgBtn.onclick = () => imageInput.click();
imageInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    attachedImageBase64 = reader.result.split(',')[1];
    attachedImageMime = file.type;
    previewImg.src = reader.result;
    previewImgName.textContent = file.name;
    imagePreviewBar.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
};
function clearImageAttachment() {
  attachedImageBase64 = null;
  attachedImageMime = null;
  imageInput.value = '';
  imagePreviewBar.classList.add('hidden');
}
document.getElementById('removeImgBtn').onclick = clearImageAttachment;

chatForm.onsubmit = (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;
  userInput.value = '';
  sendMessage(text);
};

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chatForm.dispatchEvent(new Event('submit')); }
});

document.querySelectorAll('.starter-card').forEach(card => {
  card.onclick = () => sendMessage(card.getAttribute('data-prompt'));
});

document.getElementById('newChatBtn').onclick = createNewChat;
document.getElementById('clearHistoryBtn').onclick = () => {
  conversations = []; activeChatId = null; saveChats(); renderChatHistory(); renderMessages();
};
document.getElementById('openApiModalBtn').onclick = () => {
  apiKeyInput.value = apiKey; apiModal.classList.remove('hidden'); apiModal.classList.add('flex');
};
document.getElementById('closeApiModalBtn').onclick = () => { apiModal.classList.add('hidden'); apiModal.classList.remove('flex'); };
document.getElementById('saveApiKeyBtn').onclick = () => {
  apiKey = apiKeyInput.value.trim();
  localStorage.setItem('ASTRA_GEMINI_API_KEY', apiKey);
  updateApiBadge();
  apiModal.classList.add('hidden');
  apiModal.classList.remove('flex');
};
document.getElementById('exportChatBtn').onclick = () => {
  const currentChat = conversations.find(c => c.id === activeChatId);
  if (!currentChat || currentChat.messages.length === 0) return;
  const content = currentChat.messages.map(m => `${m.role.toUpperCase()}:\n${m.text}\n`).join('\n---\n\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${currentChat.title.replace(/[^a-z0-9]/gi, '_')}.txt`;
  a.click();
};

const sidebar = document.getElementById('sidebar');
document.getElementById('openSidebarBtn').onclick = () => sidebar.classList.remove('-translate-x-full');
document.getElementById('closeSidebarBtn').onclick = () => sidebar.classList.add('-translate-x-full');

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

init();
          
