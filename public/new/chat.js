import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, limit, where, orderBy, limitToLast, startAfter, getDocs, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collectionGroup, arrayUnion, arrayRemove, onSnapshot, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyB5Q0kHoViWJl-t-pWCKj_AT-ClAMadfrU",
  authDomain: "life-swap-6065e.firebaseapp.com",
  projectId: "life-swap-6065e",
  storageBucket: "life-swap-6065e.firebasestorage.app",
  messagingSenderId: "475311181000",
  appId: "1:475311181000:web:32d03d80f70081bfb629fd",
  measurementId: "G-CHJY2ZEYYF"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const MESSAGES_PER_PAGE = 10;
const MAX_MESSAGE_LENGTH = 500;
let lastMessageDoc = null;
let userMessageCount = 0;
let lastSendTime = 0;
let lastSentMessage = null;
const RATE_LIMIT_MS = 1000;

let chatModal = null;
let postSuggestions = null;
let postConfirmPopup = null;
let linkConfirmPopup = null;
let selectedPost = null;

function getChatId(uid1, uid2) {
  return [uid1, uid2].sort().join("_");
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function getUserData(uid) {
  try {
    const userRef = doc(db, "users", uid);
    const userDoc = await getDoc(userRef);
    return userDoc.exists() ? userDoc.data() : { name: "Unknown", swaps: 0 };
  } catch (error) {
    console.error(`Error fetching user ${uid}:`, error);
    return { name: "Unknown", swaps: 0 };
  }
}

function renderMessageText(text, fromUser = null) {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const phonePattern = /(\b\d{3}[-.]?\d{3}[-.]?\d{4}\b)/g;
  let rendered = text
    .replace(urlPattern, '<a href="$1" class="chat-link" target="_blank">$1</a><span class="warning">x <span class="tooltip">Be careful! Links can be unsafe—Life Swap recommends caution.</span></span>')
    .replace(phonePattern, '$1<span class="warning">x <span class="tooltip">Be careful! Sharing phone numbers can be risky—Life Swap recommends caution.</span></span>');
  if (fromUser) rendered = `<strong>${fromUser}</strong>: ${rendered}`;
  return rendered;
}

async function openChat(targetUid, communityId = null) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    alert("You need to be logged in to chat!");
    return;
  }

  const chatId = getChatId(currentUser.uid, targetUid);
  userMessageCount = 0;
  lastMessageDoc = null;
  lastSentMessage = null;

  if (!chatModal) {
    chatModal = document.createElement("div");
    chatModal.id = "chatModal";
    chatModal.className = "chat-modal hidden";
    chatModal.innerHTML = `
      <div class="chat-modal-content">
        <div class="chat-header">
          <h2>Chat with <span id="chatPartnerName"></span></h2>
          <div>
            <button id="allChatsBtn" class="chat-action-btn">All Chats</button>
            <button id="refreshChatBtn" class="chat-action-btn">Refresh</button>
            <button id="blockUserBtn" class="chat-action-btn"></button>
            <button id="deleteChatBtn" class="chat-action-btn delete">Delete Chat</button>
            <button id="closeChatBtn" class="chat-action-btn">Close</button>
          </div>
        </div>
        <div id="chatMessages" class="chat-messages">
          <div id="loadMorePrompt" class="load-more-prompt" style="display: none;">Scroll up to load older messages</div>
          <div id="messageContainer"></div>
          <div id="chatPostSuggestions" class="chat-suggestions hidden"></div>
        </div>
        <form id="chatForm" class="chat-form">
          <textarea id="chatInput" maxlength="${MAX_MESSAGE_LENGTH}" placeholder="Type a message..." required></textarea>
          <button type="submit">Send</button>
        </form>
        <div id="postConfirmPopup" class="modal hidden">
          <div class="modal-content">
            <p>Send this post in the chat?</p>
            <p id="postPreview"></p>
            <button id="confirmSendPost">Yes</button>
            <button id="cancelSendPost">No</button>
          </div>
        </div>
        <div id="linkConfirmPopup" class="modal hidden">
          <div class="modal-content">
            <p>Are you sure you want to visit this link?</p>
            <p id="linkPreview"></p>
            <button id="confirmLink">Yes</button>
            <button id="cancelLink">No</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(chatModal);
    postSuggestions = document.getElementById("chatPostSuggestions");
    postConfirmPopup = document.getElementById("postConfirmPopup");
    linkConfirmPopup = document.getElementById("linkConfirmPopup");
  }

  const targetUserData = await getUserData(targetUid);
  const currentUserData = await getUserData(currentUser.uid);
  const isBlockedByTarget = (targetUserData.blockedUsers || []).includes(currentUser.uid);
  const isTargetBlockedByCurrent = (currentUserData.blockedUsers || []).includes(targetUid);
  document.getElementById("chatPartnerName").textContent = targetUserData.name || "Unknown";
  chatModal.style.display = "flex";
  chatModal.classList.remove("hidden");

  const messagesDiv = document.getElementById("chatMessages");
  const messageContainer = document.getElementById("messageContainer");
  const loadMorePrompt = document.getElementById("loadMorePrompt");
  const loadedMessageIds = new Set();
  const blockBtn = document.getElementById("blockUserBtn");
  const chatForm = document.getElementById("chatForm");
  let unsubscribe = null;
  let isLoadingMore = false;

  if (isTargetBlockedByCurrent) {
    blockBtn.textContent = "Unblock User";
    messageContainer.innerHTML = `<p>You blocked ${targetUserData.name || "this user"}. You can't send messages.</p>`;
    chatForm.style.display = "none";
  } else if (isBlockedByTarget) {
    blockBtn.textContent = "Block User";
    messageContainer.innerHTML = `<p>${targetUserData.name || "User"} blocked you. You can't send messages.</p>`;
    chatForm.style.display = "none";
  } else {
    blockBtn.textContent = "Block User";
    chatForm.style.display = "flex";
    await startChatListener();
    await setDoc(doc(db, "users", currentUser.uid, "chatIds", chatId), { hasUnread: false }, { merge: true });
  }

  async function loadMessages() {
    if (isLoadingMore) return;
    isLoadingMore = true;

    try {
      const messagesQ = query(
        collection(db, "chats", chatId, "messages"),
        orderBy("timestamp", "desc"),
        ...(lastMessageDoc ? [startAfter(lastMessageDoc)] : []),
        limit(MESSAGES_PER_PAGE)
      );
      const snapshot = await getDocs(messagesQ);
      console.log("Loaded older messages:", snapshot.size);

      if (snapshot.empty) {
        loadMorePrompt.style.display = "none";
        return;
      }

      if (snapshot.docs.length > 0) {
        lastMessageDoc = snapshot.docs[snapshot.docs.length - 1];
        loadMorePrompt.style.display = snapshot.size === MESSAGES_PER_PAGE ? "block" : "none";
      }

      const scrollHeightBefore = messagesDiv.scrollHeight;
      const scrollTopBefore = messagesDiv.scrollTop;

      snapshot.docs.reverse().forEach((doc) => {
        if (!loadedMessageIds.has(doc.id)) {
          const msg = doc.data();
          const msgDiv = document.createElement("div");
          msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
          msgDiv.id = `msg-${doc.id}`;
          msgDiv.innerHTML = `
            <p>${renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name)}</p>
            <span class="timestamp">${new Date(msg.timestamp.toDate()).toLocaleString()}</span>
          `;
          messageContainer.insertBefore(msgDiv, messageContainer.firstChild);
          loadedMessageIds.add(doc.id);
          console.log("Added older message ID:", doc.id);
        }
      });

      messagesDiv.scrollTop = scrollTopBefore + (messagesDiv.scrollHeight - scrollHeightBefore);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      isLoadingMore = false;
    }
  }

  async function startChatListener() {
    console.log("Starting chat listener for:", chatId);
    const messagesQ = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("timestamp", "desc"),
      limitToLast(MESSAGES_PER_PAGE)
    );
    const snapshot = await getDocs(messagesQ);
    console.log("Initial load messages:", snapshot.size);
    loadedMessageIds.clear();
    messageContainer.innerHTML = "";

    if (snapshot.empty) {
      messageContainer.innerHTML = "<p>No messages yet!</p>";
      loadMorePrompt.style.display = "none";
    } else {
      snapshot.docs.reverse().forEach((doc) => {
        const msg = doc.data();
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
        msgDiv.id = `msg-${doc.id}`;
        msgDiv.innerHTML = `
          <p>${renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name)}</p>
          <span class="timestamp">${new Date(msg.timestamp.toDate()).toLocaleString()}</span>
        `;
        messageContainer.appendChild(msgDiv);
        loadedMessageIds.add(doc.id);
        console.log("Added initial message ID:", doc.id);
      });
      lastMessageDoc = snapshot.docs[snapshot.docs.length - 1];
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      loadMorePrompt.style.display = snapshot.size === MESSAGES_PER_PAGE ? "block" : "none";
    }

    const lastKnownTimestamp = snapshot.docs.length > 0 ? snapshot.docs[0].data().timestamp.toDate() : new Date(0);
    const listenerQ = query(
      collection(db, "chats", chatId, "messages"),
      where("timestamp", ">", lastKnownTimestamp),
      orderBy("timestamp", "asc")
    );

    unsubscribe = onSnapshot(listenerQ, (snapshot) => {
      console.log("New messages detected:", snapshot.docChanges().length);
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added" && !loadedMessageIds.has(change.doc.id)) {
          const msg = change.doc.data();
          const msgDiv = document.createElement("div");
          msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
          msgDiv.id = `msg-${change.doc.id}`;
          msgDiv.innerHTML = `
            <p>${renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name)}</p>
            <span class="timestamp">${new Date(msg.timestamp.toDate()).toLocaleString()}</span>
          `;
          if (messageContainer.innerHTML.includes("No messages yet")) {
            messageContainer.innerHTML = "";
          }
          messageContainer.appendChild(msgDiv);
          loadedMessageIds.add(change.doc.id);
          console.log("Added new message ID:", change.doc.id);
          messagesDiv.scrollTop = messagesDiv.scrollHeight;
        } else if (loadedMessageIds.has(change.doc.id)) {
          console.log("Duplicate message skipped:", change.doc.id);
        }
      });
    }, (error) => {
      console.error("Chat listener error:", error);
    });
  }

  messagesDiv.onscroll = debounce(() => {
    if (messagesDiv.scrollTop < 50 && loadMorePrompt.style.display === "block" && !isLoadingMore) {
      loadMessages();
    }
  }, 200);

  const chatInput = document.getElementById("chatInput");

  chatInput.oninput = debounce(async (e) => {
    const text = e.target.value;
    const atIndex = text.lastIndexOf("@");
    if (atIndex !== -1 && text.slice(atIndex + 1).length >= 0) {
      const q = communityId
        ? query(collection(db, "communities", communityId, "posts"), where("userId", "==", targetUid), limit(10))
        : query(collectionGroup(db, "posts"), where("userId", "==", targetUid), limit(10));
      const snapshot = await getDocs(q);
      postSuggestions.innerHTML = "";
      if (snapshot.empty) {
        postSuggestions.classList.add("hidden");
        return;
      }

      snapshot.forEach(doc => {
        const post = doc.data();
        const suggestion = document.createElement("div");
        suggestion.className = "suggestion-item";
        suggestion.textContent = post.title;
        suggestion.onclick = () => {
          selectedPost = { id: doc.id, ...post };
          postSuggestions.classList.add("hidden");
          postConfirmPopup.style.display = "flex";
          postConfirmPopup.classList.remove("hidden");
          document.getElementById("postPreview").textContent = `${post.title}: ${post.description}`;
        };
        postSuggestions.appendChild(suggestion);
      });
      postSuggestions.style.display = "block";
      postSuggestions.classList.remove("hidden");
      messagesDiv.scrollTop = 0;
    } else {
      postSuggestions.classList.add("hidden");
    }
  }, 300);

  document.getElementById("confirmSendPost").onclick = async (e) => {
    e.preventDefault();
    if (selectedPost) {
      const messageData = {
        senderId: currentUser.uid,
        receiverId: targetUid,
        text: `Shared Post - ${selectedPost.title}: ${selectedPost.description} (Post ID: ${selectedPost.id})`,
        timestamp: new Date(),
        seen: false
      };
      await addDoc(collection(db, "chats", chatId, "messages"), messageData);
      await updateChatIds(chatId, currentUser.uid, targetUid, messageData.timestamp, communityId);
      await sendChatNotification(targetUid, currentUser.uid, chatId);
      chatInput.value = "";
      selectedPost = null;
    }
    postConfirmPopup.style.display = "none";
    postConfirmPopup.classList.add("hidden");
  };

  document.getElementById("cancelSendPost").onclick = () => {
    postConfirmPopup.style.display = "none";
    postConfirmPopup.classList.add("hidden");
    selectedPost = null;
  };

  chatForm.onsubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isTargetBlockedByCurrent || isTargetBlockedByCurrent) return;
    const text = chatInput.value.trim();
    if (!text) return;

    const now = Date.now();
    if (now - lastSendTime < RATE_LIMIT_MS) {
      console.log("Rate limit hit");
      alert("Slow down! One message per second.");
      return;
    }

    if (text === lastSentMessage) {
      console.log("Duplicate message prevented");
      alert("You just sent that! Try something new.");
      return;
    }

    chatInput.value = "";
    const messageData = {
      senderId: currentUser.uid,
      receiverId: targetUid,
      text,
      timestamp: new Date(),
      seen: false
    };

    try {
      console.log("Sending message:", text);
      await addDoc(collection(db, "chats", chatId, "messages"), messageData);
      lastSendTime = now;
      lastSentMessage = text;
      userMessageCount++;
      await updateChatIds(chatId, currentUser.uid, targetUid, messageData.timestamp, communityId);

      if (userMessageCount === 4) {
        const tipMsg = {
          senderId: "system",
          receiverId: targetUid,
          text: 'Help us keep Life Swap free! <form action="https://www.paypal.com/donate" method="post" target="_blank"><input type="hidden" name="business" value="YOUR_PAYPAL_EMAIL_OR_ID"><input type="hidden" name="currency_code" value="USD"><button type="submit">Tip Us</button></form>',
          timestamp: new Date(),
          seen: false
        };
        await addDoc(collection(db, "chats", chatId, "messages"), tipMsg);
      }

      await sendChatNotification(targetUid, currentUser.uid, chatId);
      console.log("Message sent successfully");
    } catch (error) {
      console.error("Error sending message:", error);
      alert("Failed to send message: " + error.message);
      chatInput.value = text;
    }
  };

  blockBtn.onclick = async () => {
    if (isTargetBlockedByCurrent) {
      if (confirm(`Unblock ${targetUserData.name || "this user"}? You’ll be able to message again.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayRemove(targetUid) });
        blockBtn.textContent = "Block User";
        chatForm.style.display = "flex";
        await startChatListener();
      }
    } else {
      if (confirm(`Block ${targetUserData.name || "this user"}? You won’t be able to message each other.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayUnion(targetUid) });
        blockBtn.textContent = "Unblock User";
        messageContainer.innerHTML = `<p>You blocked ${targetUserData.name || "this user"}. You can't send messages.</p>`;
        chatForm.style.display = "none";
        if (unsubscribe) unsubscribe();
      }
    }
  };

  document.getElementById("allChatsBtn").onclick = () => {
    closeChatModal();
    window.viewChats(communityId);
  };

  document.getElementById("refreshChatBtn").addEventListener("click", debounce(async () => {
    if (unsubscribe) unsubscribe();
    await startChatListener();
  }, 1000));

  document.getElementById("deleteChatBtn").onclick = () => deleteChat(chatId, chatModal, messageContainer);

  document.getElementById("closeChatBtn").onclick = closeChatModal;

  function closeChatModal() {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      console.log("onSnapshot stopped for chat:", chatId);
    }
    if (chatModal) chatModal.style.display = "none";
    if (chatModal) chatModal.classList.add("hidden");
    if (postSuggestions) postSuggestions.classList.add("hidden");
    if (postConfirmPopup) postConfirmPopup.classList.add("hidden");
    if (linkConfirmPopup) linkConfirmPopup.classList.add("hidden");
  }
}

async function viewChats(communityId = null) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    alert("You need to be logged in to view chats!");
    return;
  }

  let viewChatsModal = document.getElementById("viewChatsModal");
  if (!viewChatsModal) {
    viewChatsModal = document.createElement("div");
    viewChatsModal.id = "viewChatsModal";
    viewChatsModal.className = "view-chats-modal hidden";
    viewChatsModal.innerHTML = `
      <div class="view-chats-modal-content">
        <h2>Your Chats</h2>
        <p>Please delete old chats to keep things tidy!</p>
        <div id="chatList"></div>
        <button id="closeChatsBtn" class="chat-action-btn">Close</button>
      </div>
    `;
    document.body.appendChild(viewChatsModal);
  }

  viewChatsModal.style.display = "flex";
  viewChatsModal.classList.remove("hidden");

  const chatList = document.getElementById("chatList");
  chatList.innerHTML = "<p>Loading chats...</p>";

  const chatIdsQ = query(
    collection(db, "users", currentUser.uid, "chatIds"),
    orderBy("lastMessageTimestamp", "desc"),
    limit(50)
  );
  const chatIdsSnapshot = await getDocs(chatIdsQ);
  const chatIds = new Set(chatIdsSnapshot.docs.map(doc => doc.id));
  console.log("Unique chat IDs fetched:", chatIds.size, "IDs:", Array.from(chatIds));

  chatList.innerHTML = ""; // Clear loading message
  if (chatIds.size === 0) {
    chatList.innerHTML = "<p>No chats yet!</p>";
  } else {
    for (const chatId of chatIds) {
      console.log("Processing chat:", chatId);
      const [uid1, uid2] = chatId.split("_");
      const otherUid = uid1 === currentUser.uid ? uid2 : uid1;
      const userData = await getUserData(otherUid);
      const messagesQ = query(collection(db, "chats", chatId, "messages"), where("receiverId", "==", currentUser.uid), where("seen", "==", false));
      const unreadSnapshot = await getDocs(messagesQ);
      const unreadCount = unreadSnapshot.size;

      const chatItem = document.createElement("div");
      chatItem.className = "chat-list-item";
      chatItem.dataset.chatId = chatId;
      chatItem.innerHTML = `
        <span>${userData.name || "Unknown"}</span>
        <div>
          ${unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : ""}
          <button class="chat-action-btn delete" data-chat-id="${chatId}">Delete</button>
        </div>
      `;
      chatItem.onclick = (e) => {
        if (e.target.tagName !== "BUTTON") {
          viewChatsModal.style.display = "none";
          viewChatsModal.classList.add("hidden");
          openChat(otherUid, communityId);
        }
      };
      chatItem.querySelector(".delete").onclick = (e) => {
        e.stopPropagation();
        deleteChat(chatId, viewChatsModal, chatList, true);
      };
      chatList.appendChild(chatItem);
      console.log("Added chat:", chatId);
    }
  }

  document.getElementById("closeChatsBtn").onclick = () => {
    viewChatsModal.style.display = "none";
    viewChatsModal.classList.add("hidden");
  };
}

async function updateChatIds(chatId, senderUid, receiverUid, timestamp, communityId = null) {
  const data = { lastMessageTimestamp: timestamp, hasUnread: false };
  const receiverData = { lastMessageTimestamp: timestamp, hasUnread: true };
  if (communityId) {
    data.communityId = communityId;
    receiverData.communityId = communityId;
  }
  await Promise.all([
    setDoc(doc(db, "users", senderUid, "chatIds", chatId), data, { merge: true }),
    setDoc(doc(db, "users", receiverUid, "chatIds", chatId), receiverData, { merge: true })
  ]);
}

async function sendChatNotification(targetUid, senderUid, chatId) {
  const senderData = await getUserData(senderUid);
  await addDoc(collection(db, "users", targetUid, "notifications"), {
    userId: targetUid,
    type: "chat",
    message: `${senderData.name || "Someone"} sent you a message!`,
    chatId,
    timestamp: new Date(),
    seen: false
  });
  const targetRef = doc(db, "users", targetUid);
  await runTransaction(db, async (transaction) => {
    const targetDoc = await transaction.get(targetRef);
    const currentCount = targetDoc.exists() ? targetDoc.data().unseenCount || 0 : 0;
    transaction.update(targetRef, { unseenCount: currentCount + 1, lastUpdated: new Date() });
  });

  if (typeof window.updateNotificationBadge === "function") {
    window.updateNotificationBadge(targetUid);
  }
}

async function deleteChat(chatId, modal, contentDiv, fromViewChats = false) {
  if (!confirm("Delete this chat? This will remove all messages and the chat itself for both users.")) return;

  const deleteOverlay = document.createElement("div");
  deleteOverlay.className = "loading-overlay";
  deleteOverlay.innerHTML = '<div class="loading-text">Deleting...</div>';
  modal.appendChild(deleteOverlay);

  try {
    const messagesRef = collection(db, "chats", chatId, "messages");
    const q = query(messagesRef, limit(500));
    let snapshot = await getDocs(q);
    while (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      snapshot = await getDocs(q);
    }

    await deleteDoc(doc(db, "chats", chatId));
    const [uid1, uid2] = chatId.split("_");
    await Promise.all([
      deleteDoc(doc(db, "users", uid1, "chatIds", chatId)),
      deleteDoc(doc(db, "users", uid2, "chatIds", chatId))
    ]);

    contentDiv.innerHTML = "<p>Chat deleted!</p>";
    if (!fromViewChats) setTimeout(() => modal.style.display = "none", 1000);
    else await viewChats(communityId);
  } finally {
    modal.removeChild(deleteOverlay);
  }
}

window.openChat = openChat;
window.viewChats = viewChats;