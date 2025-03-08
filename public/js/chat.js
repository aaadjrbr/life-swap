import { auth, db, collection, query, limit, where, orderBy, limitToLast, startAfter, getDocs, addDoc, doc, setDoc, getDoc, updateDoc, deleteDoc, writeBatch, collectionGroup, arrayUnion, arrayRemove, onSnapshot, runTransaction } from './firebaseConfig.js';

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
let viewChatsModal = null;

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

function renderMessageText(text, fromUser = null, senderId = null) {
  if (senderId === "system") {
    return `<strong>Life Swap</strong>: ${text}`;
  }

  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const phonePattern = /(\b\d{3}[-.]?\d{3}[-.]?\d{4}\b)/g;
  const postIdPattern = /\(Post ID: (\w+)\)/g;

  let rendered = text
    .replace(urlPattern, '<a href="$1" class="chat-link" target="_blank">$1</a><span class="warning">x <span class="tooltip">Be careful! Links can be unsafe—Life Swap recommends caution.</span></span>')
    .replace(phonePattern, '$1<span class="warning">x <span class="tooltip">Be careful! Sharing phone numbers can be risky—Life Swap recommends caution.</span></span>')
    .replace(postIdPattern, '(Post ID: <span class="post-id-chat" onclick="copyToClipboard(\'$1\')">$1</span>)');

  if (fromUser && senderId) {
    rendered = `<span class="username" data-uid="${senderId}">${fromUser}</span>: ${rendered}`;
  }
  return rendered;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Post ID copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy: ', err);
  });
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
        </div>
        <form id="chatForm" class="chat-form" action="#" title="💡 Type '@' to share one of your posts"> <!-- Prevent redirect -->
          <div id="chatPostSuggestions" class="chat-suggestions hidden"></div>
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
  document.getElementById("chatPartnerName").textContent = targetUserData.name || "Unknown";

  // Show modal with dummy messages immediately
  const messageContainer = document.getElementById("messageContainer");
  messageContainer.innerHTML = ""; // Clear any previous content
  for (let i = 0; i < 5; i++) { // 5 dummy messages
    const dummyMsg = document.createElement("div");
    dummyMsg.className = `chat-message dummy ${i % 2 === 0 ? "sent" : "received"}`;
    dummyMsg.innerHTML = `
      <p><span class="dummy-text"></span></p>
      <span class="timestamp dummy-timestamp"></span>
    `;
    messageContainer.appendChild(dummyMsg);
  }
  chatModal.style.display = "flex";
  chatModal.classList.remove("hidden");

  const messagesDiv = document.getElementById("chatMessages");
  const loadMorePrompt = document.getElementById("loadMorePrompt");
  const blockBtn = document.getElementById("blockUserBtn");
  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const loadedMessageIds = new Set();
  let unsubscribe = null;
  let isLoadingMore = false;

  // Rest of the function remains unchanged
  async function updateChatUI() {
    const freshCurrentUserData = await getUserData(currentUser.uid);
    const freshTargetUserData = await getUserData(targetUid);
    const isBlockedByTarget = (freshTargetUserData.blockedUsers || []).includes(currentUser.uid);
    const isTargetBlockedByCurrent = (freshCurrentUserData.blockedUsers || []).includes(targetUid);

    if (isTargetBlockedByCurrent) {
      blockBtn.textContent = "Unblock User";
      messageContainer.innerHTML = `<p>You blocked ${freshTargetUserData.name || "this user"}. You can't send messages.</p>`;
      chatForm.style.display = "none";
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    } else if (isBlockedByTarget) {
      blockBtn.textContent = "🚫 Block User";
      messageContainer.innerHTML = `<p>${freshTargetUserData.name || "User"} blocked you. You can't send messages.</p>`;
      chatForm.style.display = "none";
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    } else {
      blockBtn.textContent = "🚫 Block User";
      chatForm.style.display = "flex";
      if (!unsubscribe) {
        await startChatListener(); // This will replace dummies with real messages
      }
      await setDoc(doc(db, "users", currentUser.uid, "chatIds", chatId), { hasUnread: false }, { merge: true });
    }
  }

  await updateChatUI();

  // Block/Unblock handler
  blockBtn.onclick = async () => {
    const freshCurrentUserData = await getUserData(currentUser.uid);
    const isTargetBlockedByCurrent = (freshCurrentUserData.blockedUsers || []).includes(targetUid);

    if (isTargetBlockedByCurrent) {
      if (confirm(`Unblock ${targetUserData.name || "this user"}? You’ll be able to message again.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayRemove(targetUid) });
        if (unsubscribe) unsubscribe();
        await updateChatUI();
      }
    } else {
      if (confirm(`Block ${targetUserData.name || "this user"}? You won’t be able to message each other.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayUnion(targetUid) });
        await updateChatUI();
      }
    }
  };

  // Block/Unblock handler
  blockBtn.onclick = async () => {
    const freshCurrentUserData = await getUserData(currentUser.uid);
    const isTargetBlockedByCurrent = (freshCurrentUserData.blockedUsers || []).includes(targetUid);

    if (isTargetBlockedByCurrent) {
      if (confirm(`Unblock ${targetUserData.name || "this user"}? You’ll be able to message again.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayRemove(targetUid) });
        if (unsubscribe) unsubscribe(); // Clear any existing listener
        await updateChatUI(); // Refresh UI and restart listener
      }
    } else {
      if (confirm(`Block ${targetUserData.name || "this user"}? You won’t be able to message each other.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayUnion(targetUid) });
        await updateChatUI(); // Refresh UI immediately
      }
    }
  };

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
          const p = document.createElement("p");
          p.innerHTML = renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name, msg.senderId);
          const timestampSpan = document.createElement("span");
          timestampSpan.className = "timestamp";
          timestampSpan.textContent = new Date(msg.timestamp.toDate()).toLocaleString();
          msgDiv.appendChild(p);
          msgDiv.appendChild(timestampSpan);
          messageContainer.insertBefore(msgDiv, messageContainer.firstChild);
          loadedMessageIds.add(doc.id);
          console.log("Added older message ID:", doc.id);

          const usernameEl = msgDiv.querySelector(".username");
          if (usernameEl) {
            usernameEl.addEventListener("click", () => {
              chatModal.style.zIndex = "1000";
              window.viewProfile(msg.senderId);
              setTimeout(() => {
                const profileModal = document.querySelector(".profile-modal");
                if (profileModal) profileModal.style.zIndex = "2000";
              }, 50);
            });
          }
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
    const messagesDiv = document.getElementById("chatMessages");
    const messageContainer = document.getElementById("messageContainer");
    const loadMorePrompt = document.getElementById("loadMorePrompt");
    const currentUser = auth.currentUser;
  
    // Clear any previous state
    loadedMessageIds.clear();
    messageContainer.innerHTML = "";
  
    // Step 1: Fetch the most recent 10 messages (or fewer if less exist)
    const initialQuery = query(
      collection(db, "chats", chatId, "messages"),
      orderBy("timestamp", "desc"),
      limit(MESSAGES_PER_PAGE)
    );
    const initialSnapshot = await getDocs(initialQuery);
    console.log("Initial load messages:", initialSnapshot.size);
  
    if (initialSnapshot.empty) {
      messageContainer.innerHTML = "<p>No messages yet!</p>";
      loadMorePrompt.style.display = "none";
    } else {
      // Render initial messages in reverse order (oldest to newest within the 10)
      initialSnapshot.docs.reverse().forEach((doc) => {
        const msg = doc.data();
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
        msgDiv.id = `msg-${doc.id}`;
        const p = document.createElement("p");
        p.innerHTML = renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name, msg.senderId);
        const timestampSpan = document.createElement("span");
        timestampSpan.className = "timestamp";
        timestampSpan.textContent = new Date(msg.timestamp.toDate()).toLocaleString();
        msgDiv.appendChild(p);
        msgDiv.appendChild(timestampSpan);
        messageContainer.appendChild(msgDiv);
        loadedMessageIds.add(doc.id);
        console.log("Added initial message ID:", doc.id);
  
        const usernameEl = msgDiv.querySelector(".username");
        if (usernameEl) {
          usernameEl.addEventListener("click", () => {
            chatModal.style.zIndex = "1000";
            window.viewProfile(msg.senderId);
            setTimeout(() => {
              const profileModal = document.querySelector(".profile-modal");
              if (profileModal) profileModal.style.zIndex = "2000";
            }, 50);
          });
        }
      });
  
      // Set the last document for pagination
      lastMessageDoc = initialSnapshot.docs[initialSnapshot.docs.length - 1]; // Oldest of the initial batch
      loadMorePrompt.style.display = initialSnapshot.size === MESSAGES_PER_PAGE ? "block" : "none";
      messagesDiv.scrollTop = messagesDiv.scrollHeight; // Scroll to bottom
    }
  
    // Step 2: Set the listener start time to *now* to catch only future messages
    const listenerStartTime = new Date(); // Current time when listener is set up
    console.log("Listener start time:", listenerStartTime);
  
    // Step 3: Listen for truly new messages (added after listenerStartTime)
    const listenerQuery = query(
      collection(db, "chats", chatId, "messages"),
      where("timestamp", ">", listenerStartTime), // Only messages after this moment
      orderBy("timestamp", "asc")
    );
  
    unsubscribe = onSnapshot(listenerQuery, (snapshot) => {
      console.log("New messages detected:", snapshot.docChanges().length);
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added" && !loadedMessageIds.has(change.doc.id)) {
          const msg = change.doc.data();
          const msgDiv = document.createElement("div");
          msgDiv.className = `chat-message ${msg.senderId === currentUser.uid ? "sent" : "received"} ${msg.senderId === "system" ? "auto" : ""}`;
          msgDiv.id = `msg-${change.doc.id}`;
          msgDiv.innerHTML = `
            <p>${renderMessageText(msg.text, msg.senderId === currentUser.uid ? currentUserData.name : targetUserData.name, msg.senderId)}</p>
            <span class="timestamp">${new Date(msg.timestamp.toDate()).toLocaleString()}</span>
          `;
          if (messageContainer.innerHTML.includes("No messages yet")) {
            messageContainer.innerHTML = "";
          }
          messageContainer.appendChild(msgDiv);
          loadedMessageIds.add(change.doc.id);
          console.log("Added new message ID:", change.doc.id);
  
          const usernameEl = msgDiv.querySelector(".username");
          if (usernameEl) {
            usernameEl.addEventListener("click", () => {
              chatModal.style.zIndex = "1000";
              window.viewProfile(msg.senderId);
              setTimeout(() => {
                const profileModal = document.querySelector(".profile-modal");
                if (profileModal) profileModal.style.zIndex = "2000";
              }, 50);
            });
          }
          messagesDiv.scrollTop = messagesDiv.scrollHeight; // Auto-scroll to new message
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
          // Clear the "@" and anything after it from the input
          chatInput.value = text.substring(0, atIndex).trim(); // Keep text before "@", remove "@" and beyond
        };
        postSuggestions.appendChild(suggestion);
      });
      postSuggestions.style.display = "block";
      postSuggestions.classList.remove("hidden");
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    } else {
      postSuggestions.classList.add("hidden");
    }
  }, 300);

  document.getElementById("confirmSendPost").onclick = async (e) => {
    e.preventDefault();
    if (!selectedPost) return;
  
    const confirmBtn = document.getElementById("confirmSendPost");
    confirmBtn.disabled = true; // Prevent double-click
    postConfirmPopup.style.display = "none"; // Close immediately
    postConfirmPopup.classList.add("hidden");
  
    try {
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
      chatInput.value = ""; // Final clear after sending (redundant but safe)
      selectedPost = null;
    } catch (error) {
      console.error("Error sending post:", error);
      alert("Failed to send post: " + error.message);
    } finally {
      confirmBtn.disabled = false; // Re-enable button
    }
  };

  document.getElementById("cancelSendPost").onclick = () => {
    postConfirmPopup.style.display = "none";
    postConfirmPopup.classList.add("hidden");
    selectedPost = null;
  };

  chatForm.onsubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log("Form submitted, prevented default");
    const freshCurrentUserData = await getUserData(currentUser.uid);
    const freshTargetUserData = await getUserData(targetUid);
    const isTargetBlockedByCurrent = (freshCurrentUserData.blockedUsers || []).includes(targetUid);
    const isBlockedByTarget = (freshTargetUserData.blockedUsers || []).includes(currentUser.uid);

    if (isTargetBlockedByCurrent || isBlockedByTarget) {
      console.log("Blocked, aborting send");
      return;
    }

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
      console.log("User message count:", userMessageCount);
      await updateChatIds(chatId, currentUser.uid, targetUid, messageData.timestamp, communityId);
      await sendChatNotification(targetUid, currentUser.uid, chatId);

      if (userMessageCount === 4) {
        const tipMsg = {
          senderId: "system",
          receiverId: targetUid,
          text: 'Hey there! Sorry to interrupt, but if you’re enjoying Life Swap, consider helping us stay free with a small donation. Every bit helps! <a href="https://www.paypal.com/donate?business=YOUR_PAYPAL_EMAIL_OR_ID¤cy_code=USD" target="_blank">Donate via PayPal</a>',
          timestamp: new Date(),
          seen: false
        };
        await addDoc(collection(db, "chats", chatId, "messages"), tipMsg);
        console.log("System message sent:", tipMsg);
        userMessageCount = 0;
      }
    } catch (error) {
      console.error("Error:", error);
      alert("Failed to send message: " + error.message);
      chatInput.value = text;
    }
  };

  blockBtn.onclick = async () => {
    const freshCurrentUserData = await getUserData(currentUser.uid);
    const isTargetBlockedByCurrent = (freshCurrentUserData.blockedUsers || []).includes(targetUid);

    if (isTargetBlockedByCurrent) {
      if (confirm(`Unblock ${targetUserData.name || "this user"}? You’ll be able to message again.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayRemove(targetUid) });
        if (unsubscribe) unsubscribe();
        await updateChatUI();
      }
    } else {
      if (confirm(`Block ${targetUserData.name || "this user"}? You won’t be able to message each other.`)) {
        await updateDoc(doc(db, "users", currentUser.uid), { blockedUsers: arrayUnion(targetUid) });
        await updateChatUI();
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

  // Initialize or reuse viewChatsModal
  if (!viewChatsModal) {
    viewChatsModal = document.createElement("div");
    viewChatsModal.id = "viewChatsModal";
    viewChatsModal.className = "view-chats-modal hidden"; // Start hidden
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

  const chatList = document.getElementById("chatList");
  
  // Add dummy chats immediately
  chatList.innerHTML = ""; // Clear previous content
  for (let i = 0; i < 3; i++) { // 3 dummy chats
    const dummyChat = document.createElement("div");
    dummyChat.className = "chat-list-item dummy";
    dummyChat.innerHTML = `
      <span class="dummy-text">Loading...</span>
      <div>
        <span class="unread-count dummy-count"></span>
        <button class="chat-action-btn delete dummy-btn" disabled></button>
      </div>
    `;
    chatList.appendChild(dummyChat);
  }
  viewChatsModal.style.display = "flex"; // Show modal with dummies
  viewChatsModal.classList.remove("hidden");

  // Fetch real chats
  const chatIdsQ = query(
    collection(db, "users", currentUser.uid, "chatIds"),
    orderBy("lastMessageTimestamp", "desc"),
    limit(50)
  );
  const chatIdsSnapshot = await getDocs(chatIdsQ);
  const chatIds = new Set(chatIdsSnapshot.docs.map(doc => doc.id));
  console.log("Unique chat IDs fetched:", chatIds.size, "IDs:", Array.from(chatIds));

  // Clear dummies and load real chats
  chatList.innerHTML = ""; // Remove dummies
  if (chatIds.size === 0) {
    chatList.innerHTML = "<p>No chats yet!</p>";
  } else {
    for (const chatId of chatIds) {
      console.log("Processing chat:", chatId);
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
      chatItem.dataset.chatId = chatId;
      chatItem.innerHTML = `
        <span>${userData.name || "Unknown"}</span>
        <div>
          ${unreadCount > 0 ? `<span class="unread-count">${unreadCount}</span>` : ""}
          <button class="chat-action-btn delete" data-chat-id="${chatId}">Delete</button>
        </div>
      `;
      chatItem.onclick = async (e) => {
        if (e.target.tagName !== "BUTTON") {
          if (unreadCount > 0) {
            const batch = writeBatch(db);
            unreadSnapshot.docs.forEach((doc) => {
              batch.update(doc.ref, { seen: true });
            });
            await batch.commit();
            console.log(`Marked ${unreadCount} messages as seen for chat: ${chatId}`);
            await setDoc(
              doc(db, "users", currentUser.uid, "chatIds", chatId),
              { hasUnread: false },
              { merge: true }
            );
            console.log(`Cleared hasUnread for chat: ${chatId}`);
            const unreadSpan = chatItem.querySelector(".unread-count");
            if (unreadSpan) {
              unreadSpan.remove();
            }
          }
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

  // Setup loading overlay with progress
  const deleteOverlay = document.createElement("div");
  deleteOverlay.className = "loading-overlay2";
  deleteOverlay.innerHTML = `
    <div class="loading-text2">
      Deleting chat... <span id="deleteProgress">0 messages</span>
    </div>
  `;
  const progressSpan = deleteOverlay.querySelector("#deleteProgress");
  modal.appendChild(deleteOverlay);

  try {
    const messagesRef = collection(db, "chats", chatId, "messages");
    let totalDeleted = 0;

    // Get total message count for progress (optional, could skip if too costly)
    const totalSnapshot = await getDocs(messagesRef);
    const totalMessages = totalSnapshot.size;
    console.log(`Total messages to delete: ${totalMessages}`);

    // Delete in batches
    const BATCH_SIZE = 500; // Firestore batch limit
    const q = query(messagesRef, limit(BATCH_SIZE));
    let snapshot = await getDocs(q);
    
    while (!snapshot.empty) {
      const batch = writeBatch(db);
      snapshot.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += snapshot.docs.length;
      progressSpan.textContent = `${totalDeleted}${totalMessages > 0 ? ` of ${totalMessages}` : ""} messages`;
      console.log(`Deleted batch: ${snapshot.docs.length}, Total deleted: ${totalDeleted}`);
      snapshot = await getDocs(q); // Fetch next batch
    }

    // Clean up chat metadata (no need for chats/{chatId} if it’s just a collection group)
    const [uid1, uid2] = chatId.split("_");
    await Promise.all([
      deleteDoc(doc(db, "users", uid1, "chatIds", chatId)),
      deleteDoc(doc(db, "users", uid2, "chatIds", chatId))
    ]);
    console.log(`Deleted chat metadata for ${uid1} and ${uid2}`);

    contentDiv.innerHTML = "<p>Chat deleted!</p>";
    if (!fromViewChats) {
      setTimeout(() => {
        modal.style.display = "none";
        modal.classList.add("hidden");
      }, 1000);
    } else {
      await viewChats(communityId); // Refresh chat list
    }
  } catch (error) {
    console.error("Error deleting chat:", error);
    contentDiv.innerHTML = "<p>Error deleting chat. Try again.</p>";
    setTimeout(() => {
      modal.style.display = "none";
      modal.classList.add("hidden");
    }, 2000);
  } finally {
    modal.removeChild(deleteOverlay);
  }
}

window.openChat = openChat;
window.viewChats = viewChats;
window.copyToClipboard = copyToClipboard;