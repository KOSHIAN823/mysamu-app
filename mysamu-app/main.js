// Firebase v9+ (modular) SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { 
    getFirestore, doc, onSnapshot, setDoc, getDoc, serverTimestamp, 
    addDoc, collection, query, orderBy, deleteDoc, runTransaction, where, updateDoc, getDocs
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-storage.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-check.js";


// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDiRayvEJ27XHrhwgpl0Fl2HkInpkssaHA", // ご自身のAPIキーに書き換えてください
    authDomain: "mysamu-app.firebaseapp.com",
    projectId: "mysamu-app",
    storageBucket: "mysamu-app.firebasestorage.app", // ご自身の値に書き換えてください
    messagingSenderId: "577582013908",
    appId: "1:577582013908:web:ff0ada048944d52131ca41",
    measurementId: "G-QPKGG0FZC5"
};

// --- FIREBASE INITIALIZATION ---
let app, auth, db, storage;
try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);

    initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider('6LcnQYsrAAAAALTjzUQN7xdYzyODDPJ6T29Sytpn'), // コンソールで取得するキーをここに貼る
        isTokenAutoRefreshEnabled: true
    });
} catch (e) {
    console.error("Firebaseの初期化に失敗しました:", e);
    const loadingView = document.getElementById('view-loading');
    loadingView.innerHTML = `<p class="error-text">アプリの初期化に失敗しました。Firebaseの設定情報を確認してください。</p>`;
}

// --- STATE MANAGEMENT ---
let userId = null;
let userProfile = null;
let isAuthReady = false;
let activeTab = 'rosters';
let profileUnsubscribe = null;
let currentViewUnsubscribe = null;

// --- DOM ELEMENT REFERENCES ---
const views = {
    loading: document.getElementById('view-loading'),
    auth: document.getElementById('view-auth'),
    messages: document.getElementById('view-messages'),
    calendar: document.getElementById('view-calendar'),
    rooms: document.getElementById('view-rooms'),
    rosters: document.getElementById('view-rosters'),
    sponsorships: document.getElementById('view-sponsorships'),
    collection: document.getElementById('view-collection'),
};
const navButtons = document.querySelectorAll('.nav-button');
const modalContainer = document.getElementById('modalContainer');
const modalContent = document.getElementById('modalContent');

// --- UTILITY FUNCTIONS ---
const escapeHTML = str => str ? str.replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[match]) : '';
const formatDateToInput = (date) => { if (!date) return ''; return date.toISOString().split('T')[0]; };
const createSafeUrl = (url) => {
    if (typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
        return url;
    }
    return '#';
};

// --- UI & VIEW MANAGEMENT ---
const switchView = (viewName) => {
    if (currentViewUnsubscribe) currentViewUnsubscribe();
    currentViewUnsubscribe = null;
    activeTab = viewName;
    Object.values(views).forEach(view => view.classList.remove('active'));
    if (views[viewName]) views[viewName].classList.add('active');
    navButtons.forEach(button => {
        button.classList.toggle('active', button.dataset.tab === viewName);
        button.classList.toggle('inactive', button.dataset.tab !== viewName);
    });
    switch (viewName) {
        case 'messages': renderMessageBoard(); break;
        case 'calendar': renderCalendar(); break;
        case 'rooms': renderPracticeRooms(); break;
        case 'rosters': renderRosters(); break;
        case 'sponsorships': renderSponsorships(); break;
        case 'collection': renderCollection(); break;
    }
};

const updateUI = () => {
    if (!isAuthReady) {
        switchView('loading');
    } else if (userId && !userProfile) {
        renderProfileFormScreen();
        switchView('auth');
    } else if (userProfile) {
        views.loading.classList.remove('active');
        views.auth.classList.remove('active');
        switchView(activeTab);
    } else {
        renderGoogleLoginScreen();
        switchView('auth');
    }
};

// --- MODAL ---
const showModal = (message, isConfirm = false, onConfirm = null) => {
    let buttonsHtml = isConfirm 
        ? `<button id="modalConfirmBtn" class="btn btn-primary" style="background-color: #dc2626;">はい</button>
           <button id="modalCloseBtn" class="btn btn-secondary" style="background-color: #6b7280;">いいえ</button>`
        : `<button id="modalCloseBtn" class="btn btn-primary">閉じる</button>`;
    modalContent.innerHTML = `
        <p class="modal-message">${escapeHTML(message)}</p>
        <div class="modal-button-container">${buttonsHtml}</div>
    `;
    modalContainer.classList.add('active');
    document.getElementById('modalCloseBtn').onclick = hideModal;
    if (isConfirm && onConfirm) {
        document.getElementById('modalConfirmBtn').onclick = () => {
            onConfirm();
            hideModal();
        };
    }
};
const hideModal = () => {
    modalContainer.classList.remove('active');
    modalContent.innerHTML = '';
};
modalContainer.addEventListener('click', (e) => {
    if (e.target === modalContainer) hideModal();
});

// --- AUTHENTICATION ---
onAuthStateChanged(auth, async (user) => {
    const header = document.querySelector('.app-header');
    let logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.remove();
    if (profileUnsubscribe) profileUnsubscribe();

    if (user) {
        userId = user.uid;
        header.insertAdjacentHTML('beforeend', `<button id="logoutBtn" class="btn btn-secondary" style="position: absolute; top: 1rem; left: 1rem; padding: 0.5rem 1rem;">ログアウト</button>`);
        document.getElementById('logoutBtn').addEventListener('click', () => signOut(auth));
        
        const profileDocRef = doc(db, `users/${userId}`);
        profileUnsubscribe = onSnapshot(profileDocRef, (profileSnap) => {
            userProfile = profileSnap.exists() ? { id: profileSnap.id, ...profileSnap.data() } : null;
            isAuthReady = true;
            updateUI();
        });
    } else {
        userId = null;
        userProfile = null;
        isAuthReady = true; 
        updateUI();
    }
});

const renderGoogleLoginScreen = () => {
    views.auth.innerHTML = `
        <div class="content-card" style="max-width: 28rem; margin: 3rem auto; text-align: center;">
            <h2 class="content-title">ようこそ！</h2>
            <p style="color: #4b5563; margin-bottom: 2rem;">
                アプリの全機能を利用するには、Googleアカウントでのログインが必要です。
            </p>
            <button id="googleLoginBtn" class="btn btn-primary" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin: 0 auto;">
                <svg style="width:20px; height:20px;" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35,11.1H12.18V13.83H18.69C18.36,17.64 15.19,19.27 12.19,19.27C8.36,19.27 5,16.25 5,12C5,7.75 8.36,4.73 12.19,4.73C14.03,4.73 15.69,5.36 16.95,6.45L19.2,4.22C17.22,2.46 14.92,1.5 12.19,1.5C6.63,1.5 2.19,5.93 2.19,12C2.19,18.07 6.63,22.5 12.19,22.5C17.6,22.5 21.6,18.66 21.6,12.23C21.6,11.72 21.5,11.4 21.35,11.1Z" /></svg>
                Googleでログイン
            </button>
            <div id="authError" class="error-text" style="padding: 1rem 0 0 0;"></div>
        </div>
    `;
    document.getElementById('googleLoginBtn').addEventListener('click', handleGoogleSignIn);
};

const handleGoogleSignIn = async () => {
    const provider = new GoogleAuthProvider();
    const errorDiv = document.getElementById('authError');
    if (!errorDiv) return;
    errorDiv.textContent = '';
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Googleサインインエラー:", error);
        if (error.code === 'auth/popup-blocked') {
            errorDiv.textContent = 'ポップアップがブロックされました。ブラウザの設定でポップアップを許可してください。';
        } else {
            errorDiv.textContent = 'ログインに失敗しました。もう一度お試しください。';
        }
    }
};

const renderProfileFormScreen = () => {
    views.auth.innerHTML = `
        <div class="content-card" style="max-width: 28rem; margin: 3rem auto;">
            <h2 class="content-title">プロフィール登録</h2>
            <p style="text-align: center; color: #4b5563; margin-bottom: 1.5rem;">MYSAMUアプリをご利用いただくために、あなたの情報を登録してください。</p>
            <div id="authError" class="error-text" style="padding: 0 0 1rem 0; min-height: 24px;"></div>
            <div class="space-y-4">
                <div><label for="realName" class="form-label">本名:</label><input type="text" id="realName" class="form-input" required /></div>
                <div><label for="yosana" class="form-label">よさな:</label><input type="text" id="yosana" class="form-input" required /></div>
                <div>
                    <label for="grade" class="form-label">回生:</label>
                    <select id="grade" class="form-select">
                        ${['1年生', '2年生', '3年生', '4年生', 'OB/OG'].map(opt => `<option value="${opt}">${opt}</option>`).join('')}
                    </select>
                </div>
                <div><label for="dob" class="form-label">生年月日:</label><input type="date" id="dob" class="form-input" required /></div>
                <div><label for="university" class="form-label">所属大学:</label><input type="text" id="university" class="form-input" required /></div>
                <div><label for="faculty" class="form-label">学部:</label><input type="text" id="faculty" class="form-input" required /></div>
            </div>
            <button id="registerProfileBtn" class="btn btn-primary" style="width: 100%; margin-top: 2rem;">プロフィールを登録</button>
        </div>
    `;
    document.getElementById('registerProfileBtn').addEventListener('click', handleRegisterProfile);
};

const handleRegisterProfile = async () => {
    const btn = document.getElementById('registerProfileBtn');
    const errorDiv = document.getElementById('authError');
    errorDiv.textContent = '';
    const profileData = {
        realName: document.getElementById('realName').value.trim(),
        yosana: document.getElementById('yosana').value.trim(),
        grade: document.getElementById('grade').value,
        dob: document.getElementById('dob').value,
        university: document.getElementById('university').value.trim(),
        faculty: document.getElementById('faculty').value.trim(),
    };
    if (Object.values(profileData).some(val => !val)) {
        errorDiv.textContent = 'すべての項目を入力してください。';
        return;
    }
    btn.textContent = '登録中...';
    btn.disabled = true;
    try {
        const userProfileRef = doc(db, `users/${userId}`);
        await setDoc(userProfileRef, { ...profileData, registeredAt: serverTimestamp() });
    } catch (e) {
        console.error("プロフィール登録エラー:", e);
        errorDiv.textContent = 'プロフィールの登録に失敗しました。';
        btn.textContent = 'プロフィールを登録';
        btn.disabled = false;
    }
};

// --- (ここから各機能の完全なコードが始まります) ---

// --- MESSAGE BOARD ---
const renderMessageBoard = () => {
    views.messages.innerHTML = `<div id="messages-content"></div>`;
    renderMessageListView();
};

const handleDeleteMessage = async (messageId) => {
    try {
        await deleteDoc(doc(db, `public/data/messages`, messageId));
        showModal('メッセージを削除しました。');
    } catch(e) {
        console.error("メッセージ削除エラー:", e);
        showModal('メッセージの削除に失敗しました。');
    }
};

const renderMessageListView = () => {
    const container = document.getElementById('messages-content');
    const categories = ['練習案内', 'お祭り関連', 'お部屋', '三役', 'お動画', '集金', 'その他'];
    container.innerHTML = `
        <div class="flex-between" style="margin-bottom: 1rem;">
            <h2 class="content-title" style="text-align: left; margin: 0;">連絡ボード</h2>
            <button id="newMessageBtn" class="btn btn-primary">新規作成</button>
        </div>
        <div style="margin-bottom: 1.5rem; display: flex; flex-wrap: wrap; gap: 0.5rem;">
             <button class="btn category-btn active" data-category="すべて">すべて</button>
             ${categories.map(cat => `<button class="btn category-btn" data-category="${escapeHTML(cat)}">${escapeHTML(cat)}</button>`).join('')}
        </div>
        <div id="messageList" class="space-y-4">
             <p class="loading-text">メッセージを読み込み中...</p>
        </div>
    `;
    document.getElementById('newMessageBtn').addEventListener('click', renderCreateMessageForm);
    
    let allMessages = [];
    
    const renderFilteredMessages = (category) => {
        const listEl = document.getElementById('messageList');
        const filtered = category === 'すべて' ? allMessages : allMessages.filter(msg => msg.category === category);

        if (filtered.length === 0) {
            listEl.innerHTML = `<p class="info-text">該当するメッセージはありません。</p>`;
            return;
        }

        listEl.innerHTML = filtered.map(msg => {
            const canDelete = userProfile && (userProfile.role === 'admin' || msg.senderId === userId);
            return `
                <div class="item-list-item">
                    <div class="flex-between">
                        <div style="cursor: pointer; flex-grow: 1; margin-right: 1rem;" data-message-id="${msg.id}" class="message-title-wrapper">
                            <p style="font-weight: bold; font-size: 1.1rem;">${escapeHTML(msg.subject)}</p>
                            <p style="color: #4b5563;">from: ${escapeHTML(msg.senderName)}</p>
                        </div>
                        <div style="text-align: right; display: flex; align-items: center; gap: 1rem; flex-shrink: 0;">
                            <div>
                                <p style="font-size: 0.875rem; color: #6b7280;">${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleDateString() : ''}</p>
                                <span style="font-size: 0.75rem; background-color: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 9999px;">${escapeHTML(msg.category || 'その他')}</span>
                            </div>
                            ${canDelete ? `<button class="btn delete-message-btn" data-message-id="${msg.id}" style="background-color: #ef4444; padding: 0.5rem;">削除</button>` : ''}
                        </div>
                    </div>
                </div>
            `}).join('');
    };

    document.querySelectorAll('#view-messages .category-btn').forEach(btn => {
        btn.onclick = (e) => {
            document.querySelectorAll('#view-messages .category-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            renderFilteredMessages(e.target.dataset.category);
        };
    });

    document.getElementById('messageList').addEventListener('click', (e) => {
        if (e.target.closest('.message-title-wrapper')) {
            const item = e.target.closest('.message-title-wrapper');
            const msgId = item.dataset.messageId;
            const selectedMsg = allMessages.find(m => m.id === msgId);
            if (selectedMsg) renderMessageDetailView(selectedMsg);
        }
        if (e.target.classList.contains('delete-message-btn')) {
            const msgId = e.target.dataset.messageId;
            showModal('このメッセージを削除しますか？', true, () => handleDeleteMessage(msgId));
        }
    });
    
    const messagesRef = collection(db, `public/data/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'desc'));

    currentViewUnsubscribe = onSnapshot(q, (snapshot) => {
        allMessages = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        const activeCategoryBtn = document.querySelector('#view-messages .category-btn.active');
        if (activeCategoryBtn) {
            renderFilteredMessages(activeCategoryBtn.dataset.category);
        }
    }, (error) => {
        console.error("メッセージの取得エラー:", error);
        document.getElementById('messageList').innerHTML = `<p class="error-text">メッセージの読み込みに失敗しました。</p>`;
    });
};

const renderMessageDetailView = (msg) => {
    const container = document.getElementById('messages-content');
    container.innerHTML = `
        <button id="backToListBtn" class="btn btn-secondary" style="margin-bottom: 1.5rem;">&lt; 一覧に戻る</button>
        <div style="padding: 1.5rem; background: white; border-radius: 0.75rem; border: 1px solid #e5e7eb;">
            <div class="flex-between" style="margin-bottom: 0.5rem;">
                <h3 style="font-size: 1.5rem; font-weight: bold; margin:0;">${escapeHTML(msg.subject)}</h3>
                <span style="font-size: 0.875rem; background-color: #e5e7eb; padding: 0.25rem 0.5rem; border-radius: 9999px;">${escapeHTML(msg.category)}</span>
            </div>
            <div class="flex-between" style="font-size: 0.875rem; color: #6b7280; margin-bottom: 1rem; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.5rem;">
                <span>From: ${escapeHTML(msg.senderName)}</span>
                <span>${msg.timestamp ? new Date(msg.timestamp.toDate()).toLocaleString() : ''}</span>
            </div>
            <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHTML(msg.body)}</p>
        </div>
    `;
    document.getElementById('backToListBtn').addEventListener('click', renderMessageListView);
};

const renderCreateMessageForm = () => {
    const categories = ['練習案内', 'お祭り関連', 'お部屋', '三役', 'お動画', '集金', 'その他'];
    const container = document.getElementById('messages-content');
    container.innerHTML = `
        <h2 class="content-title">新規メッセージ作成</h2>
        <div id="createMsgError" class="error-text" style="padding: 0 0 1rem 0;"></div>
        <div class="space-y-4">
            <div>
                <label class="form-label">ジャンル:</label>
                <select id="newMsgCategory" class="form-select">${categories.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
            </div>
            <div>
                <label class="form-label">件名:</label>
                <input type="text" id="newMsgSubject" class="form-input" />
            </div>
            <div>
                <label class="form-label">本文:</label>
                <textarea id="newMsgBody" rows="10" class="form-textarea"></textarea>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 1rem; margin-top: 1rem;">
                <button id="cancelMsgBtn" class="btn btn-secondary">キャンセル</button>
                <button id="sendMsgBtn" class="btn btn-primary">送信</button>
            </div>
        </div>
    `;

    document.getElementById('cancelMsgBtn').addEventListener('click', renderMessageListView);
    document.getElementById('sendMsgBtn').addEventListener('click', async () => {
        const btn = document.getElementById('sendMsgBtn');
        const errorDiv = document.getElementById('createMsgError');
        errorDiv.textContent = '';
        
        const messageData = {
            subject: document.getElementById('newMsgSubject').value.trim(),
            body: document.getElementById('newMsgBody').value.trim(),
            category: document.getElementById('newMsgCategory').value
        };

        if (!messageData.subject || !messageData.body) {
            errorDiv.textContent = '件名と本文を両方入力してください。';
            return;
        }
        
        btn.textContent = '送信中...';
        btn.disabled = true;

        try {
            await addDoc(collection(db, `public/data/messages`), {
                ...messageData,
                senderId: userId,
                senderName: userProfile.yosana || '匿名',
                timestamp: serverTimestamp()
            });
            renderMessageListView();
        } catch (e) {
            console.error("メッセージ送信エラー:", e);
            errorDiv.textContent = 'メッセージの送信に失敗しました。';
            btn.textContent = '送信';
            btn.disabled = false;
        }
    });
};

// --- CALENDAR ---
const renderCalendar = () => {
    let currentMonth = new Date();
    let selectedDate = new Date();
    let events = [];

    const draw = () => {
        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = [];
        for (let i = 0; i < firstDay.getDay(); i++) { daysInMonth.push(null); }
        for (let i = 1; i <= lastDay.getDate(); i++) { daysInMonth.push(new Date(year, month, i)); }

        const hasEventOnDate = (date) => {
             if (!date) return false;
             return events.some(event => {
                 const eventStart = new Date(event.startDate.toDate()); eventStart.setHours(0,0,0,0);
                 const eventEnd = new Date(event.endDate.toDate()); eventEnd.setHours(0,0,0,0);
                 return date >= eventStart && date <= eventEnd;
             });
        };
        
        const eventsForSelectedDate = events.filter(event => {
            const eventStart = new Date(event.startDate.toDate()); eventStart.setHours(0,0,0,0);
            const eventEnd = new Date(event.endDate.toDate()); eventEnd.setHours(0,0,0,0);
            return selectedDate >= eventStart && selectedDate <= eventEnd;
        }).sort((a, b) => a.startDate.toDate() - b.startDate.toDate());

        views.calendar.innerHTML = `
            <h2 class="content-title">カレンダー</h2>
            <div id="calendarError" class="error-text" style="padding: 0 0 1rem 0;"></div>
            <div class="flex-between" style="padding: 1rem; background-color: #f9fafb; border-radius: 1rem; margin-bottom: 1rem;">
                <button id="prevMonthBtn" class="btn btn-secondary">&lt; 前の月</button>
                <h3 style="font-size: 1.5rem; font-weight: bold;">${year}年 ${month + 1}月</h3>
                <button id="nextMonthBtn" class="btn btn-secondary">次の月 &gt;</button>
            </div>
            <div class="calendar-grid">
                ${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join('')}
                ${daysInMonth.map(date => {
                    if (!date) return `<div class="calendar-day calendar-day-empty"></div>`;
                    const todayClass = date.toDateString() === new Date().toDateString() ? 'calendar-day-today' : '';
                    const selectedClass = selectedDate && date.toDateString() === selectedDate.toDateString() ? 'calendar-day-selected' : '';
                    return `
                        <div class="calendar-day ${todayClass} ${selectedClass}" data-date="${date.toISOString()}">
                            <span class="calendar-day-number">${date.getDate()}</span>
                            ${hasEventOnDate(date) ? '<div class="calendar-event-dot"></div>' : ''}
                        </div>
                    `;
                }).join('')}
            </div>

            <div class="form-section">
                <h3 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">イベントを追加</h3>
                <div class="space-y-4">
                    <div><label class="form-label">イベントタイトル:</label><input type="text" id="newEventTitle" class="form-input" /></div>
                    <div style="display: flex; gap: 1rem;">
                        <div style="flex: 1;"><label class="form-label">開始日:</label><input type="date" id="newEventStartDate" class="form-input" /></div>
                        <div style="flex: 1;"><label class="form-label">終了日:</label><input type="date" id="newEventEndDate" class="form-input" /></div>
                    </div>
                    <div><label class="form-label">詳細:</label><textarea id="newEventDescription" rows="3" class="form-textarea"></textarea></div>
                    <button id="addEventBtn" class="btn btn-primary" style="width: 100%;">イベントを追加</button>
                </div>
            </div>
            
            <div>
                <h3 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日のイベント一覧</h3>
                <div id="eventList" class="space-y-4">
                    ${eventsForSelectedDate.length === 0 ? '<p class="info-text">この日のイベントはありません。</p>' : eventsForSelectedDate.map(event => `
                        <div class="item-list-item flex-between">
                            <div>
                                <h4 style="font-weight: bold; font-size: 1.1rem;">${escapeHTML(event.title)}</h4>
                                <p style="color: #6b7280; font-size: 0.9rem;">期間: ${formatDateToInput(event.startDate.toDate())} ~ ${formatDateToInput(event.endDate.toDate())}</p>
                                ${event.description ? `<p style="color: #374151; white-space: pre-wrap; margin-top: 0.5rem;">${escapeHTML(event.description)}</p>` : ''}
                            </div>
                            ${(userProfile && userProfile.role === 'admin') || event.creatorId === userId ? `<button class="btn btn-secondary delete-event-btn" data-event-id="${event.id}" style="background-color: #ef4444; flex-shrink: 0; margin-left: 1rem;">削除</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        
        document.getElementById('newEventStartDate').value = formatDateToInput(selectedDate);
        document.getElementById('newEventEndDate').value = formatDateToInput(selectedDate);
        
        document.getElementById('prevMonthBtn').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() - 1); draw(); };
        document.getElementById('nextMonthBtn').onclick = () => { currentMonth.setMonth(currentMonth.getMonth() + 1); draw(); };
        document.querySelectorAll('.calendar-day').forEach(day => {
            if (day.dataset.date) {
                day.onclick = () => { selectedDate = new Date(day.dataset.date); draw(); };
            }
        });
        document.getElementById('addEventBtn').onclick = handleAddEvent;
        document.querySelectorAll('.delete-event-btn').forEach(btn => {
            btn.onclick = () => {
                showModal('このイベントを削除してもよろしいですか？', true, () => handleDeleteEvent(btn.dataset.eventId));
            };
        });
    };

    const handleAddEvent = async () => {
        const title = document.getElementById('newEventTitle').value.trim();
        const startDateStr = document.getElementById('newEventStartDate').value;
        const endDateStr = document.getElementById('newEventEndDate').value;
        const description = document.getElementById('newEventDescription').value.trim();
        const errorDiv = document.getElementById('calendarError');
        errorDiv.textContent = '';

        if (!title || !startDateStr || !endDateStr) {
            errorDiv.textContent = 'タイトル、開始日、終了日を入力してください。';
            return;
        }
        const startDate = new Date(startDateStr);
        const endDate = new Date(endDateStr);
        if (startDate > endDate) {
            errorDiv.textContent = '終了日は開始日以降の日付を選択してください。';
            return;
        }

        try {
            await addDoc(collection(db, `public/data/calendarEvents`), {
                title, description, startDate, endDate, creatorId: userId, timestamp: serverTimestamp()
            });
            document.getElementById('newEventTitle').value = '';
            document.getElementById('newEventDescription').value = '';
            showModal('イベントを追加しました！');
        } catch (e) {
            console.error("Error adding event:", e);
            errorDiv.textContent = 'イベントの追加に失敗しました。';
        }
    };
    
    const handleDeleteEvent = async (eventId) => {
        try {
            await deleteDoc(doc(db, `public/data/calendarEvents`, eventId));
            showModal('イベントを削除しました！');
        } catch (e) {
            console.error("Error deleting event:", e);
            document.getElementById('calendarError').textContent = 'イベントの削除に失敗しました。';
        }
    };

    const eventsCollectionRef = collection(db, `public/data/calendarEvents`);
    const q = query(eventsCollectionRef, orderBy('startDate'));
    currentViewUnsubscribe = onSnapshot(q, (snapshot) => {
        events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        draw();
    }, (err) => {
        console.error("Error fetching events:", err);
        views.calendar.innerHTML += `<p class="error-text">カレンダーイベントの読み込みに失敗しました。</p>`;
    });
};

// --- PRACTICE ROOMS ---
const renderPracticeRooms = () => {
    let selectedDate = new Date();
    let reservations = [];
    let rooms = [];
    
    const periods = ['1限 (8:50-10:30)', '2限 (10:40-12:20)', '昼限 (12:20-13:10)', '3限 (13:10-14:50)', '4限 (15:05-16:45)', '5限 (17:00-18:40)', '6限 (18:55-20:35)', '夜限 (20:45-21:35)'];
    const periodValues = periods.map(p => p.split(' ')[0]);
    const formatDate = (date) => date.toISOString().split('T')[0];

    const draw = () => {
        const dateStr = formatDate(selectedDate);
        const sortedReservations = reservations.filter(r => r.date === dateStr).sort((a,b) => periodValues.indexOf(a.period) - periodValues.indexOf(b.period));
        const occupiedRooms = rooms.filter(room => room.currentOccupant);

        views.rooms.innerHTML = `
            <h2 class="content-title">練習部屋予約</h2>
            <div id="roomError" class="error-text" style="padding: 0 0 1rem 0;"></div>
            <div class="flex-between" style="padding: 1rem; background-color: #f9fafb; border-radius: 1rem; margin-bottom: 1rem;">
                <button id="prevDayBtn" class="btn btn-secondary">&lt; 前日</button>
                <h3 style="font-size: 1.5rem; font-weight: bold;">${selectedDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</h3>
                <button id="nextDayBtn" class="btn btn-secondary">翌日 &gt;</button>
            </div>

            <div class="form-section">
                <h3 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">新規予約</h3>
                 <div style="display: flex; flex-direction: column; gap: 1rem; md:flex-direction: row;">
                     <select id="newPeriod" class="form-select">${periodValues.map(p => `<option value="${p}">${p}</option>`).join('')}</select>
                     <input type="text" id="newRoom" placeholder="部屋名 (例: Aスタジオ)" class="form-input" />
                     <button id="addReservationBtn" class="btn btn-primary">予約する</button>
                 </div>
            </div>

            <div id="reservationList" class="space-y-4" style="margin-bottom: 3rem;">
                ${periods.map(periodWithTime => {
                    const periodValue = periodWithTime.split(' ')[0];
                    const periodReservations = sortedReservations.filter(r => r.period === periodValue);
                    return `
                        <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 1rem; align-items: start; padding-bottom: 1rem; border-bottom: 1px solid #e5e7eb;">
                            <div style="font-weight: bold; color: #374151;">${periodWithTime}</div>
                            <div class="space-y-4">
                                ${periodReservations.length > 0 ? periodReservations.map(res => `
                                    <div class="flex-between" style="background: #fff; padding: 0.5rem; border-radius: 0.375rem; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                                        <div>
                                            <span style="font-weight: 600;">${escapeHTML(res.roomName)}</span>
                                            <span style="font-size: 0.8rem; color: #6b7280; margin-left: 0.5rem;">(${escapeHTML(res.reservedByName)})</span>
                                        </div>
                                        ${(userProfile && userProfile.role === 'admin') || res.reservedByUserId === userId ? `<button class="delete-reservation-btn" data-period="${res.period}" data-room="${res.roomName}" style="color: #ef4444; background: none; border: none; cursor: pointer; font-weight: bold;">削除</button>` : ''}
                                    </div>
                                `).join('') : '<p style="color: #9ca3af;">予約なし</p>'}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>

            <hr style="margin: 3rem 0; border: none; border-top: 1px solid #d1d5db;"/>

            <h2 class="content-title">リアルタイム入室状況</h2>
             <div class="form-section">
                <h3 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">部屋にチェックイン</h3>
                <div style="display: flex; border-radius: 0.5rem; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <input type="text" id="newCheckInRoom" placeholder="使用する部屋名を入力..." class="form-input" style="border-radius: 0; border: none;" />
                    <button id="checkInBtn" class="btn btn-primary" style="border-radius: 0;">チェックイン</button>
                </div>
            </div>

            <h3 style="font-size: 1.25rem; font-weight: bold; margin-bottom: 1rem;">現在使用中の部屋</h3>
            <div id="occupiedRoomsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1.5rem;">
                 ${occupiedRooms.length === 0 ? '<p class="info-text">現在使用中の部屋はありません。</p>' : occupiedRooms.map(room => `
                    <div style="background: #fff; padding: 1rem; border-radius: 0.75rem; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                        <h4 style="font-weight: bold; font-size: 1.2rem;">${escapeHTML(room.name)}</h4>
                        <p>使用中: <span style="font-weight: 600; color: var(--highlight-text);">${escapeHTML(room.currentOccupant)}</span></p>
                        ${room.checkedInAt ? `<p style="font-size: 0.8rem; color: #6b7280;">チェックイン: ${new Date(room.checkedInAt.toDate()).toLocaleString()}</p>` : ''}
                        ${room.occupantId === userId ? `<button class="btn btn-secondary check-out-btn" data-room-id="${room.id}" style="width: 100%; margin-top: 1rem;">チェックアウト</button>` : ''}
                    </div>
                 `).join('')}
            </div>
        `;
        
        document.getElementById('prevDayBtn').onclick = () => { selectedDate.setDate(selectedDate.getDate() - 1); fetchReservationsForDate(selectedDate); };
        document.getElementById('nextDayBtn').onclick = () => { selectedDate.setDate(selectedDate.getDate() + 1); fetchReservationsForDate(selectedDate); };
        document.getElementById('addReservationBtn').onclick = handleAddReservation;
        document.getElementById('checkInBtn').onclick = handleCheckIn;
        document.querySelectorAll('.delete-reservation-btn').forEach(btn => btn.onclick = (e) => handleDeleteReservation(e.target.dataset.period, e.target.dataset.room));
        document.querySelectorAll('.check-out-btn').forEach(btn => btn.onclick = (e) => handleCheckOut(e.target.dataset.roomId));
    };
    
    const fetchReservationsForDate = (date) => {
        const dateStr = formatDate(date);
        const reservationDocRef = doc(db, `public/data/roomReservations`, dateStr);
        onSnapshot(reservationDocRef, (docSnap) => {
            reservations = docSnap.exists() ? docSnap.data().reservations.map(r => ({...r, date: dateStr})) : [];
            draw();
        }, (err) => {
            console.error("Error fetching reservations:", err);
            document.getElementById('roomError').textContent = '予約情報の読み込みに失敗しました。';
        });
    };
    
    const handleAddReservation = async () => {
        const newPeriod = document.getElementById('newPeriod').value;
        const newRoom = document.getElementById('newRoom').value.trim();
        const errorDiv = document.getElementById('roomError');
        errorDiv.textContent = '';
        if (!newPeriod || !newRoom) { errorDiv.textContent = "時間と部屋名を入力してください。"; return; }
        
        const dateStr = formatDate(selectedDate);
        const reservationDocRef = doc(db, `public/data/roomReservations`, dateStr);
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(reservationDocRef);
                const existingReservations = docSnap.exists() ? docSnap.data().reservations : [];
                const isTaken = existingReservations.some(res => res.period === newPeriod && res.roomName.toLowerCase() === newRoom.toLowerCase());
                if (isTaken) throw new Error(`${newRoom}は${newPeriod}に既に予約されています。`);
                
                const newReservationData = { period: newPeriod, roomName: newRoom, reservedByUserId: userId, reservedByName: userProfile.yosana };
                transaction.set(reservationDocRef, { reservations: [...existingReservations, newReservationData] }, { merge: true });
            });
            document.getElementById('newRoom').value = '';
        } catch (e) { console.error(e); errorDiv.textContent = e.message; }
    };

    const handleDeleteReservation = async (period, roomName) => {
        const dateStr = formatDate(selectedDate);
        const reservationDocRef = doc(db, `public/data/roomReservations`, dateStr);
        try {
            await runTransaction(db, async (transaction) => {
                const docSnap = await transaction.get(reservationDocRef);
                if (!docSnap.exists()) throw new Error("予約が見つかりません。");
                const existingReservations = docSnap.data().reservations;
                const newReservations = existingReservations.filter(res => !(res.period === period && res.roomName === roomName));
                transaction.update(reservationDocRef, { reservations: newReservations });
            });
        } catch (e) { console.error(e); document.getElementById('roomError').textContent = e.message; }
    };
    
    const handleCheckIn = async () => {
        const roomName = document.getElementById('newCheckInRoom').value.trim();
        const errorDiv = document.getElementById('roomError');
        errorDiv.textContent = '';
        if (!roomName) { errorDiv.textContent = '部屋名を入力してください。'; return; }

        const roomRef = doc(db, `public/data/practiceRooms`, roomName);
        try {
            await runTransaction(db, async (transaction) => {
                const q = query(collection(db, `public/data/practiceRooms`), where("occupantId", "==", userId));
                const userRoomsSnapshot = await getDocs(q);
                if (!userRoomsSnapshot.empty) throw new Error(`あなたは既に「${userRoomsSnapshot.docs[0].data().name}」にいます。`);
                
                const roomSnap = await transaction.get(roomRef);
                if (roomSnap.exists() && roomSnap.data().currentOccupant) {
                    throw new Error(`「${roomName}」は現在、他のユーザーが使用中です。`);
                }
                const data = { name: roomName, currentOccupant: userProfile.yosana, occupantId: userId, checkedInAt: serverTimestamp() };
                transaction.set(roomRef, data, { merge: true });
            });
            document.getElementById('newCheckInRoom').value = '';
        } catch (e) { console.error(e); errorDiv.textContent = e.message; }
    };

    const handleCheckOut = async (roomId) => {
        const roomRef = doc(db, `public/data/practiceRooms`, roomId);
        try {
            await updateDoc(roomRef, { currentOccupant: null, occupantId: null, checkedInAt: null });
        } catch (e) { console.error(e); document.getElementById('roomError').textContent = 'チェックアウトに失敗しました。'; }
    };

    const roomsCollectionRef = collection(db, `public/data/practiceRooms`);
    const q = query(roomsCollectionRef, orderBy('name'));
    const unsubscribeRooms = onSnapshot(q, (snapshot) => {
        rooms = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        draw();
    });

    fetchReservationsForDate(selectedDate);

    currentViewUnsubscribe = () => { unsubscribeRooms(); };
};

// --- ROSTERS ---
const renderRosters = () => {
    let view = 'expeditionList';
    let rosterData = [];
    let selectedExpedition = null;
    let selectedStage = null;
    let imageFile = null;

    const draw = () => {
        let content = '';
        if (view === 'create') {
            content = `
                <button id="backToRostersBtn" class="btn btn-secondary" style="margin-bottom: 1.5rem;">&lt; 一覧に戻る</button>
                <div class="form-section">
                    <h3 class="content-title" style="text-align: left; margin: 0 0 1rem 0;">新規隊列表作成</h3>
                    <div id="rosterError" class="error-text" style="padding: 0 0 1rem 0;"></div>
                    <div class="space-y-4">
                        <div><label class="form-label">遠征名:</label><input type="text" id="newExpeditionName" placeholder="例: 2025年度〇〇遠征" class="form-input" /></div>
                        <div><label class="form-label">ステージ名:</label><input type="text" id="newStageName" placeholder="例: 〇〇ステージ" class="form-input" /></div>
                        <div><label class="form-label">隊列表画像 (1MB未満):</label><input type="file" id="rosterImageFile" accept="image/*" class="form-input" /></div>
                        <img id="rosterPreview" src="" alt="プレビュー" style="display: none; max-width: 100%; border-radius: 0.5rem; border: 1px solid #ccc; margin-top: 1rem;" />
                        <button id="saveRosterBtn" class="btn btn-primary" style="width: 100%;">保存</button>
                    </div>
                </div>
            `;
        } else if (selectedStage) {
            content = `
                <button id="backToStageListBtn" class="btn btn-secondary" style="margin-bottom: 1.5rem;">&lt; ${escapeHTML(selectedExpedition.name)}の一覧に戻る</button>
                <h3 class="content-title">${escapeHTML(selectedStage.name)}</h3>
                ${selectedStage.rosterImageUrl ? `<img src="${selectedStage.rosterImageUrl}" alt="${escapeHTML(selectedStage.name)} 隊列表" style="width: 100%; border-radius: 0.5rem;"/>` : '<p class="info-text">画像がありません</p>'}
            `;
        } else if (selectedExpedition) {
            content = `
                <button id="backToExpeditionListBtn" class="btn btn-secondary" style="margin-bottom: 1.5rem;">&lt; 遠征一覧に戻る</button>
                <h3 class="content-title">${escapeHTML(selectedExpedition.name)}</h3>
                <div class="space-y-4">
                    ${selectedExpedition.stages.map(stage => `
                        <div class="item-list-item" data-stage-id="${stage.id}">
                            <span style="font-weight: 600;">${escapeHTML(stage.name)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } else {
            content = `
                <div class="flex-between" style="margin-bottom: 1.5rem;">
                     <h2 class="content-title" style="text-align: left; margin: 0;">隊列表</h2>
                     <button id="createRosterBtn" class="btn btn-primary">+ 新規作成</button>
                </div>
                <div id="expeditionList" class="space-y-4">
                    ${rosterData.length > 0 ? rosterData.map(exp => `
                        <div class="item-list-item" data-expedition-id="${exp.id}">
                            <span style="font-weight: bold; font-size: 1.2rem;">${escapeHTML(exp.name)}</span>
                        </div>
                    `).join('') : '<p class="info-text">隊列表はまだありません。</p>'}
                </div>
            `;
        }
        views.rosters.innerHTML = content;
        addRosterEventListeners();
    };

    const addRosterEventListeners = () => {
        if (view === 'create') {
            document.getElementById('backToRostersBtn').onclick = () => { view = 'expeditionList'; draw(); };
            document.getElementById('saveRosterBtn').onclick = handleSaveRoster;
            document.getElementById('rosterImageFile').onchange = handleFileChange;
        } else if (selectedStage) {
            document.getElementById('backToStageListBtn').onclick = () => { selectedStage = null; draw(); };
        } else if (selectedExpedition) {
            document.getElementById('backToExpeditionListBtn').onclick = () => { selectedExpedition = null; draw(); };
            document.querySelectorAll('#view-rosters .item-list-item').forEach(item => {
                item.onclick = () => {
                    selectedStage = selectedExpedition.stages.find(s => s.id === item.dataset.stageId);
                    draw();
                };
            });
        } else {
            document.getElementById('createRosterBtn').onclick = () => { view = 'create'; draw(); };
             document.querySelectorAll('#view-rosters .item-list-item').forEach(item => {
                item.onclick = () => {
                    selectedExpedition = rosterData.find(e => e.id === item.dataset.expeditionId);
                    draw();
                };
            });
        }
    };
    
    const handleFileChange = (e) => {
        const file = e.target.files[0];
        const errorDiv = document.getElementById('rosterError');
        const preview = document.getElementById('rosterPreview');
        errorDiv.textContent = '';
        imageFile = null;
        preview.style.display = 'none';

        if (file) {
            if (file.size > 1 * 1024 * 1024) { 
                errorDiv.textContent = '画像ファイルが大きすぎます。1MB未満のファイルを選択してください。';
                e.target.value = '';
                return;
            }
            if (!file.type.startsWith('image/')) {
                errorDiv.textContent = '画像ファイルを選択してください。';
                e.target.value = '';
                return;
            }

            imageFile = file;
            const reader = new FileReader();
            reader.onloadend = () => {
                preview.src = reader.result;
                preview.style.display = 'block';
            };
            reader.readAsDataURL(file);
        }
    };
    
    const handleSaveRoster = async () => {
        const expName = document.getElementById('newExpeditionName').value.trim();
        const stageName = document.getElementById('newStageName').value.trim();
        const errorDiv = document.getElementById('rosterError');
        const btn = document.getElementById('saveRosterBtn');
        errorDiv.textContent = '';

        if (!expName || !stageName || !imageFile) {
            errorDiv.textContent = '遠征名、ステージ名、画像をすべて入力してください。';
            return;
        }

        btn.disabled = true;
        btn.textContent = '保存中...';

        try {
            const fileName = `${Date.now()}-${imageFile.name}`;
            const storageRef = ref(storage, `rosters/${userId}/${fileName}`);
            await uploadBytes(storageRef, imageFile);

            const imageUrl = await getDownloadURL(storageRef);

            const sanitizeForId = (name) => name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[.#$[\]/]/g, '_');
            const expeditionId = sanitizeForId(expName);
            const stageId = sanitizeForId(stageName);

            const expeditionRef = doc(db, `public/data/expeditions`, expeditionId);
            await setDoc(expeditionRef, { name: expName, uploaderId: userId, timestamp: serverTimestamp() }, { merge: true });

            const stageRef = doc(db, `public/data/expeditions/${expeditionId}/stages`, stageId);
            await setDoc(stageRef, { name: stageName, rosterImageUrl: imageUrl, uploaderId: userId, timestamp: serverTimestamp() });
            
            view = 'expeditionList';
        } catch (e) {
            console.error("Error saving roster:", e);
            errorDiv.textContent = '隊列表の保存に失敗しました。';
            btn.disabled = false;
            btn.textContent = '保存';
        }
    };

    const expeditionsCollectionRef = collection(db, `public/data/expeditions`);
    const q = query(expeditionsCollectionRef, orderBy('timestamp', 'desc'));
    currentViewUnsubscribe = onSnapshot(q, async (expeditionsSnapshot) => {
        rosterData = await Promise.all(expeditionsSnapshot.docs.map(async (doc) => {
            const exp = { id: doc.id, ...doc.data() };
            const stagesCollectionRef = collection(db, `public/data/expeditions/${exp.id}/stages`);
            const stagesQuery = query(stagesCollectionRef, orderBy('timestamp', 'asc'));
            const stagesSnapshot = await getDocs(stagesQuery);
            exp.stages = stagesSnapshot.docs.map(stageDoc => ({ id: stageDoc.id, ...stageDoc.data() }));
            return exp;
        }));
        draw();
    });
};
    
// --- SPONSORSHIPS ---
const renderSponsorships = () => {
    let formMode = null;
    let sponsorships = [];
    let currentFormData = { id: null, title: '', url: '', description: '', expirationDate: '' };

    const draw = () => {
        const activeSponsorships = sponsorships.filter(s => !s.isExpired);
        const expiredSponsorships = sponsorships.filter(s => s.isExpired);

        views.sponsorships.innerHTML = `
            <h2 class="content-title">学生協賛</h2>
            <div id="sponsorshipError" class="error-text" style="padding: 0 0 1rem 0;"></div>
            ${!formMode ? `<div style="text-align: right; margin-bottom: 1.5rem;"><button id="addNewSponsorshipBtn" class="btn btn-primary">+ 新規協賛を追加</button></div>` : ''}
            
            <div id="sponsorshipFormContainer"></div>

            <h3 class="content-title" style="font-size: 1.5rem; margin-top: 2rem; margin-bottom: 1rem;">実施中の協賛一覧</h3>
            <div class="space-y-4">
                ${activeSponsorships.length > 0 ? activeSponsorships.map(item => sponsorshipItemHtml(item)).join('') : '<p class="info-text">実施中の協賛はありません。</p>'}
            </div>

            <h3 class="content-title" style="font-size: 1.5rem; margin-top: 2rem; margin-bottom: 1rem; color: #6b7280;">期限切れの協賛</h3>
             <div class="space-y-4">
                ${expiredSponsorships.length > 0 ? expiredSponsorships.map(item => sponsorshipItemHtml(item)).join('') : '<p class="info-text">期限切れの協賛はありません。</p>'}
            </div>
        `;
        if (formMode) drawForm();
        addSponsorshipEventListeners();
    };
    
    const sponsorshipItemHtml = (item) => `
        <div class="item-list-item flex-between" style="${item.isExpired ? 'background-color: #f3f4f6; color: #6b7280;' : ''}">
            <a href="${createSafeUrl(item.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit; flex-grow: 1;">
                <span style="font-weight: bold; font-size: 1.1rem;">${escapeHTML(item.title)}</span>
                <span style="display: block; font-size: 0.9rem;">期限: ${item.expirationDate || 'なし'}</span>
                ${item.description ? `<p style="font-size: 0.9rem; margin-top: 0.5rem;">${escapeHTML(item.description)}</p>` : ''}
            </a>
            ${(userProfile && userProfile.role === 'admin') || item.uploaderId === userId ? `
                <div style="display: flex; gap: 0.5rem; margin-left: 1rem;">
                    <button class="btn btn-secondary edit-sponsorship-btn" data-item-id="${item.id}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem;">編集</button>
                    <button class="btn btn-secondary delete-sponsorship-btn" data-item-id="${item.id}" style="padding: 0.25rem 0.75rem; font-size: 0.8rem; background-color: #ef4444;">削除</button>
                </div>
            ` : ''}
        </div>
    `;
    
    const drawForm = () => {
        document.getElementById('sponsorshipFormContainer').innerHTML = `
            <div class="form-section">
                <h3 class="content-title" style="text-align: left; margin: 0 0 1rem 0;">${formMode === 'add' ? '新しい協賛を追加' : '協賛を編集'}</h3>
                <div class="space-y-4">
                    <div><label class="form-label">協賛タイトル:</label><input type="text" id="sponsorshipTitle" class="form-input" value="${escapeHTML(currentFormData.title)}"></div>
                    <div><label class="form-label">協賛の期限:</label><input type="date" id="sponsorshipExpiration" class="form-input" value="${escapeHTML(currentFormData.expirationDate)}"></div>
                    <div><label class="form-label">URL:</label><input type="url" id="sponsorshipUrl" placeholder="https://example.com" class="form-input" value="${escapeHTML(currentFormData.url)}"></div>
                    <div><label class="form-label">詳細:</label><textarea id="sponsorshipDesc" rows="3" class="form-textarea">${escapeHTML(currentFormData.description)}</textarea></div>
                    <div style="display: flex; justify-content: flex-end; gap: 1rem;">
                        <button id="cancelSponsorshipFormBtn" class="btn btn-secondary">キャンセル</button>
                        <button id="saveSponsorshipBtn" class="btn btn-primary">保存</button>
                    </div>
                </div>
            </div>
        `;
        document.getElementById('cancelSponsorshipFormBtn').onclick = () => { formMode = null; draw(); };
        document.getElementById('saveSponsorshipBtn').onclick = handleSaveSponsorship;
    };

    const addSponsorshipEventListeners = () => {
        if (!formMode) document.getElementById('addNewSponsorshipBtn').onclick = () => {
            formMode = 'add';
            currentFormData = { id: null, title: '', url: '', description: '', expirationDate: '' };
            draw();
        };
        document.querySelectorAll('.edit-sponsorship-btn').forEach(btn => btn.onclick = (e) => {
            e.stopPropagation();
            const item = sponsorships.find(s => s.id === e.target.dataset.itemId);
            if (item) {
                formMode = 'edit';
                currentFormData = { ...item };
                draw();
            }
        });
        document.querySelectorAll('.delete-sponsorship-btn').forEach(btn => btn.onclick = (e) => {
            e.stopPropagation();
            const item = sponsorships.find(s => s.id === e.target.dataset.itemId);
            if(item) showModal('この協賛情報を削除しますか？', true, () => handleDeleteSponsorship(item.id));
        });
    };
    
    const handleSaveSponsorship = async () => {
        const errorDiv = document.getElementById('sponsorshipError');
        errorDiv.textContent = '';
        const dataToSave = {
            title: document.getElementById('sponsorshipTitle').value.trim(),
            url: document.getElementById('sponsorshipUrl').value.trim(),
            description: document.getElementById('sponsorshipDesc').value.trim(),
            expirationDate: document.getElementById('sponsorshipExpiration').value,
        };
        if (!dataToSave.title || !dataToSave.url || !dataToSave.expirationDate) {
            errorDiv.textContent = 'タイトル、URL、期限をすべて入力してください。';
            return;
        }
        
        try {
            if (formMode === 'edit') {
                const docRef = doc(db, `public/data/studentSponsorships`, currentFormData.id);
                await updateDoc(docRef, dataToSave);
            } else {
                await addDoc(collection(db, `public/data/studentSponsorships`), { ...dataToSave, uploaderId: userId, timestamp: serverTimestamp() });
            }
            formMode = null;
        } catch (e) {
            console.error("Error saving sponsorship:", e);
            errorDiv.textContent = '協賛情報の保存に失敗しました。';
        }
    };
    
    const handleDeleteSponsorship = async (itemId) => {
        try {
            await deleteDoc(doc(db, `public/data/studentSponsorships`, itemId));
        } catch (e) {
            console.error("Error deleting sponsorship:", e);
            document.getElementById('sponsorshipError').textContent = "削除に失敗しました。";
        }
    };

    const sponsorshipsCollectionRef = collection(db, `public/data/studentSponsorships`);
    const q = query(sponsorshipsCollectionRef, orderBy('expirationDate', 'desc'));
    currentViewUnsubscribe = onSnapshot(q, (snapshot) => {
        const now = new Date();
        now.setHours(0, 0, 0, 0); 
        sponsorships = snapshot.docs.map(doc => {
            const data = doc.data();
            const expiration = data.expirationDate ? new Date(data.expirationDate + 'T00:00:00') : null;
            return { id: doc.id, ...data, isExpired: expiration ? expiration < now : false };
        });
        draw();
    });
};

// --- COLLECTION ---
const renderCollection = () => {
    views.collection.innerHTML = `<h2 class="content-title">集金</h2><p class="info-text">この機能は現在開発中です。</p>`;
};

// --- EVENT LISTENERS ---
navButtons.forEach(button => {
    button.addEventListener('click', () => {
        if (userProfile) {
            switchView(button.dataset.tab);
        }
    });
});

document.getElementById('themeSelector').addEventListener('change', (e) => {
    document.body.className = `theme-${e.target.value}`;
});

const scroller = document.getElementById('navScroller');
const leftArrow = document.getElementById('navScrollLeft');
const rightArrow = document.getElementById('navScrollRight');

const checkScroll = () => {
    if (!scroller) return;
    const hasOverflow = scroller.scrollWidth > scroller.clientWidth;
    leftArrow.style.display = hasOverflow && scroller.scrollLeft > 1 ? 'flex' : 'none';
    rightArrow.style.display = hasOverflow && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1 ? 'flex' : 'none';
};

scroller.addEventListener('scroll', checkScroll);
window.addEventListener('resize', checkScroll);
leftArrow.addEventListener('click', () => scroller.scrollLeft -= scroller.clientWidth * 0.8);
rightArrow.addEventListener('click', () => scroller.scrollLeft += scroller.clientWidth * 0.8);

setTimeout(checkScroll, 100);