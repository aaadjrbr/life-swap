import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, limit, startAfter, getDocs, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collectionGroup, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

const MESSAGES_PER_PAGE = 20;
const MAX_MESSAGE_LENGTH = 500;
let lastMessageDoc = null;
let userMessageCount = 0;
let lastSendTime = 0;
let lastRefreshTime = 0;
const RATE_LIMIT_MS = 1000;

let chatModal = null;
let postSuggestions = null;
let postConfirmPopup = null;
let linkConfirmPopup = null;
let selectedPost = null; // Moved outside to persist across function calls

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
  const userRef = doc(db, "users", uid);
  const userDoc = await getDoc(userRef);
  return userDoc.exists() ? userDoc.data() : { name: "Unknown", swaps: 0 };
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
          <div id="chatPostSuggestions" class="chat-suggestions hidden"></div>
        </div>
        <button id="loadMoreMessages" style="display: none;">Load More</button>
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
  const loadedMessageIds = new Set();
  const blockBtn = document.getElementById("blockUserBtn");
  const chatForm = document.getElementById("chatForm");

  if (isTargetBlockedByCurrent) {
    blockBtn.textContent = "Unblock User";
    messagesDiv.innerHTML = `<p>You blocked ${targetUserData.name || "this user"}. You can't send messages.</p>`;
    chatForm.style.display = "none";
  } else if (isBlockedByTarget) {
    blockBtn.textContent = "Block User";
    messagesDiv.innerHTML = `<p>${targetUserData.name || "User"} blocked you. You can't send messages.</p>`;
    chatForm.style.display = "none";
  } else {
    blockBtn.textContent = "Block User";
    chatForm.style.display = "flex";
    await loadMessages(true);
  }

  async function loadMessages(reset = false) {
    const now = Date.now();
    if (now - lastRefreshTime < RATE_LIMIT_MS) {
      alert("Slow down, bro! One refresh per second.");
      return;
    }
    lastRefreshTime = now;

    if (reset) {
      lastMessageDoc = null;
      loadedMessageIds.clear();
      // Preserve suggestions
      const existingSuggestions = messagesDiv.querySelector("#chatPostSuggestions");
      messagesDiv.innerHTML = "";
      if (existingSuggestions) {
        messagesDiv.appendChild(existingSuggestions);
      } else {
        messagesDiv.innerHTML = "<div id='chatPostSuggestions' class='chat-suggestions hidden'></div>";
      }
    }

    const messagesQ = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("timestamp", "desc"),
      ...(lastMessageDoc && !reset ? [startAfter(lastMessageDoc)] : []),
      limit(MESSAGES_PER_PAGE)
    );
    const snapshot = await getDocs(messagesQ);
    if (snapshot.empty && reset) {
      messagesDiv.innerHTML = "<p>No messages yet!</p>";
      messagesDiv.appendChild(document.createElement("div")).id = "chatPostSuggestions";
      messagesDiv.querySelector("#chatPostSuggestions").className = "chat-suggestions hidden";
      document.getElementById("loadMoreMessages").style.display = "none";
      return;
    }

    if (snapshot.docs.length > 0) {
      lastMessageDoc = snapshot.docs[0];
      document.getElementById("loadMoreMessages").style.display = snapshot.size === MESSAGES_PER_PAGE ? "block" : "none";
    }

    const messages = snapshot.docs.reverse();
    messages.forEach((doc) => {
      if (!loadedMessageIds.has(doc.id)) {
        const msg = doc.data();
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
        msgDiv.innerHTML = `
          <p>${renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name)}</p>
          <span class="timestamp">${new Date(msg.timestamp.toDate()).toLocaleString()}</span>
        `;
        const links = msgDiv.querySelectorAll(".chat-link");
        links.forEach(link => {
          link.onclick = (e) => {
            e.preventDefault();
            const href = link.getAttribute("href");
            linkConfirmPopup.style.display = "flex";
            linkConfirmPopup.classList.remove("hidden");
            document.getElementById("linkPreview").textContent = href;
            document.getElementById("confirmLink").onclick = () => window.open(href, "_blank");
            document.getElementById("cancelLink").onclick = () => {
              linkConfirmPopup.style.display = "none";
              linkConfirmPopup.classList.add("hidden");
            };
          };
        });
        messagesDiv.insertBefore(msgDiv, messagesDiv.querySelector("#chatPostSuggestions"));
        loadedMessageIds.add(doc.id);
      }
    });

    if (reset) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
      const firstNewMessage = messagesDiv.querySelector(".chat-message:not(#chatPostSuggestions)");
      if (firstNewMessage) {
        firstNewMessage.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  document.getElementById("loadMoreMessages").onclick = () => loadMessages(false);

  const chatInput = document.getElementById("chatInput");

  chatInput.oninput = debounce(async (e) => {
    const text = e.target.value;
    const atIndex = text.lastIndexOf("@");
    if (atIndex !== -1 && text.slice(atIndex + 1).length >= 0) {
      console.log(`Fetching posts for ${targetUid}, communityId: ${communityId}`);
      const q = communityId
        ? query(
            collection(db, "communities", communityId, "posts"),
            where("userId", "==", targetUid),
            limit(10)
          )
        : query(
            collectionGroup(db, "posts"),
            where("userId", "==", targetUid),
            limit(10)
          );
      const snapshot = await getDocs(q);
      console.log(`Found ${snapshot.size} posts`);
      postSuggestions.innerHTML = "";
      if (snapshot.empty) {
        console.log("No posts found, hiding suggestions");
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
          console.log(`Selected post: ${post.title}`);
        };
        postSuggestions.appendChild(suggestion);
      });
      console.log("Showing suggestions");
      postSuggestions.style.display = "block"; // Ensure display kicks in
      postSuggestions.classList.remove("hidden");
      messagesDiv.scrollTop = 0; // Scroll to top to show suggestions
    } else {
      console.log("Hiding suggestions - no @");
      postSuggestions.classList.add("hidden");
    }
  }, 300);

  document.getElementById("confirmSendPost").onclick = async () => {
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
      await loadMessages(true);
      selectedPost = null; // Clear after sending
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
    if (isTargetBlockedByCurrent || isBlockedByTarget) return;
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;

    const now = Date.now();
    if (now - lastSendTime < RATE_LIMIT_MS) {
      alert("Slow down, bro! One message per second.");
      return;
    }

    const messageData = {
      senderId: currentUser.uid,
      receiverId: targetUid,
      text,
      timestamp: new Date(),
      seen: false
    };

    await addDoc(collection(db, "chats", chatId, "messages"), messageData);
    lastSendTime = now;
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

    chatInput.value = "";
    await loadMessages(true);
  };

  blockBtn.onclick = async () => {
    if (isTargetBlockedByCurrent) {
      if (confirm(`Unblock ${targetUserData.name || "this user"}? You’ll be able to message again.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), {
          blockedUsers: arrayRemove(targetUid)
        });
        blockBtn.textContent = "Block User";
        chatForm.style.display = "flex";
        await loadMessages(true);
      }
    } else {
      if (confirm(`Block ${targetUserData.name || "this user"}? You won’t be able to message each other.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), {
          blockedUsers: arrayUnion(targetUid)
        });
        blockBtn.textContent = "Unblock User";
        messagesDiv.innerHTML = `<p>You blocked ${targetUserData.name || "this user"}. You can't send messages.</p>`;
        chatForm.style.display = "none";
      }
    }
  };

  document.getElementById("allChatsBtn").onclick = () => {
    closeChatModal();
    window.viewChats(communityId);
  };

  document.getElementById("refreshChatBtn").addEventListener("click", debounce(() => loadMessages(true), 1000));

  document.getElementById("deleteChatBtn").onclick = async () => deleteChat(chatId, chatModal, messagesDiv);

  document.getElementById("closeChatBtn").onclick = closeChatModal;

  function closeChatModal() {
    if (chatModal) chatModal.style.display = "none";
    if (chatModal) chatModal.classList.add("hidden");
    if (postSuggestions) postSuggestions.classList.add("hidden");
    if (postConfirmPopup) postConfirmPopup.classList.add("hidden");
    if (linkConfirmPopup) linkConfirmPopup.classList.add("hidden");
  }

  messagesDiv.onscroll = debounce(() => {
    if (messagesDiv.scrollTop < 50 && document.getElementById("loadMoreMessages").style.display === "block") {
      loadMessages(false);
    }
  }, 200);
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
  let chatIdsSnapshot = await getDocs(chatIdsQ);
  let chatIds = new Set(chatIdsSnapshot.docs.map(doc => doc.id));

  if (chatIds.size === 0) {
    console.log("Falling back to scan chats collection...");
    const messagesQ = query(
      collectionGroup(db, "messages"),
      where("senderId", "==", currentUser.uid),
      limit(100)
    );
    const receivedQ = query(
      collectionGroup(db, "messages"),
      where("receiverId", "==", currentUser.uid),
      limit(100)
    );
    const [sentSnapshot, receivedSnapshot] = await Promise.all([getDocs(messagesQ), getDocs(receivedQ)]);
    sentSnapshot.forEach(doc => chatIds.add(doc.ref.parent.parent.id));
    receivedSnapshot.forEach(doc => chatIds.add(doc.ref.parent.parent.id));

    const batch = writeBatch(db);
    chatIds.forEach(chatId => {
      batch.set(doc(db, "users", currentUser.uid, "chatIds", chatId), { lastMessageTimestamp: new Date() }, { merge: true });
    });
    await batch.commit();
    chatIdsSnapshot = await getDocs(chatIdsQ);
    chatIds = new Set(chatIdsSnapshot.docs.map(doc => doc.id));
  }

  chatList.innerHTML = "";
  if (chatIds.size === 0) {
    chatList.innerHTML = "<p>No chats yet!</p>";
  } else {
    for (const chatId of chatIds) {
      const [uid1, uid2] = chatId.split("_");
      const otherUid = uid1 === currentUser.uid ? uid2 : uid1;
      const userData = await getUserData(otherUid);
      const messagesQ = query(
        collection(db, "chats", chatId, "messages"),
        where("receiverId", "==", currentUser.uid),
        where("seen", "==", false)
      );
      const unreadSnapshot = await getDocs(messagesQ);
      const unreadCount = unreadSnapshot.size;

      const chatItem = document.createElement("div");
      chatItem.className = "chat-list-item";
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
    }
  }

  document.getElementById("closeChatsBtn").onclick = () => {
    viewChatsModal.style.display = "none";
    viewChatsModal.classList.add("hidden");
  };
}

async function updateChatIds(chatId, senderUid, receiverUid, timestamp, communityId = null) {
  const data = { lastMessageTimestamp: timestamp };
  if (communityId) data.communityId = communityId;
  await Promise.all([
    setDoc(doc(db, "users", senderUid, "chatIds", chatId), data, { merge: true }),
    setDoc(doc(db, "users", receiverUid, "chatIds", chatId), data, { merge: true })
  ]);
}

async function sendChatNotification(targetUid, senderUid, chatId) {
  const senderData = await getUserData(senderUid);
  await addDoc(collection(db, "notifications"), {
    userId: targetUid,
    type: "chat",
    message: `${senderData.name || "Someone"} sent you a message!`,
    chatId,
    timestamp: new Date(),
    seen: false
  });
  if (typeof window.updateNotificationBadge === "function") {
    window.updateNotificationBadge(targetUid);
  }
}

async function deleteChat(chatId, modal, contentDiv, fromViewChats = false) {
  if (confirm("Delete this chat? This will remove all messages and the chat itself for both users.")) {
    const deleteOverlay = document.createElement("div");
    deleteOverlay.className = "loading-overlay";
    deleteOverlay.innerHTML = '<div class="loading-text">Deleting...</div>';
    modal.appendChild(deleteOverlay);

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

    modal.removeChild(deleteOverlay);
    contentDiv.innerHTML = "<p>Chat deleted!</p>";
    if (!fromViewChats) setTimeout(() => modal.style.display = "none", 1000);
    else await viewChats(communityId);
  }
}

window.openChat = openChat;
window.viewChats = viewChats;