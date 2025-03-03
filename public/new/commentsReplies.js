import { auth, doc, where, getDoc, startAfter, runTransaction, addDoc, deleteDoc, getDocs, query, collection, db, orderBy, limit } from './firebaseConfig.js';
import { communityId } from './main.js';

export { toggleComments };

const itemsPerPage = 10;

async function showTagSuggestions(textarea, postId) {
    const text = textarea.value;
    const match = text.match(/@(\w*)$/);
    const suggestionsDiv = document.getElementById(`tagSuggestions-${postId}`);
  
    suggestionsDiv.innerHTML = "";
    suggestionsDiv.classList.add("hidden");
  
    if (match && match[1].length > 0) {
      const prefix = match[1].toLowerCase();
  
      // Get current user
      const currentUser = auth.currentUser;
      if (!currentUser) {
        console.error("No current user found for tag suggestions!");
        return;
      }
  
      // Fetch users you follow from your 'following' subcollection
      const followingRef = collection(db, "users", currentUser.uid, "following");
      let followingSnapshot;
      try {
        followingSnapshot = await getDocs(followingRef);
      } catch (error) {
        console.error("Error fetching following list:", error);
        return;
      }
  
      const followedUsers = followingSnapshot.docs.map(doc => ({
        uid: doc.data().followingId,
        username: doc.data().username || "Unknown"
      }));
      console.log("Fetched followed users:", followedUsers);
  
      // Filter users you follow by username prefix
      const filteredUsers = followedUsers
        .filter(user => user.username.toLowerCase().startsWith(prefix))
        .slice(0, 5);
  
      if (filteredUsers.length > 0) {
        suggestionsDiv.style.position = "absolute";
        suggestionsDiv.style.left = `${textarea.offsetLeft}px`;
        suggestionsDiv.style.top = `${textarea.offsetTop + textarea.offsetHeight}px`;
        suggestionsDiv.classList.remove("hidden");
  
        filteredUsers.forEach(user => {
          const suggestion = document.createElement("div");
          suggestion.classList.add("suggestion-item");
          suggestion.textContent = `@${user.username}`;
          suggestion.addEventListener("click", () => {
            textarea.value = text.replace(/@\w*$/, `@${user.username} `);
            suggestionsDiv.classList.add("hidden");
          });
          suggestionsDiv.appendChild(suggestion);
        });
      }
    }
  }
  
  // Existing click listener stays unchanged
  document.addEventListener("click", (e) => {
    const allTagSuggestionDivs = document.querySelectorAll("[id^='tagSuggestions-']");
    allTagSuggestionDivs.forEach(div => {
      const textarea = div.previousElementSibling;
      if (!div.contains(e.target) && (!textarea || !textarea.contains(e.target))) {
        div.classList.add("hidden");
      }
    });
    const postLocationSuggestions = document.getElementById("postLocationSuggestions");
    if (postLocationSuggestions && !postLocationSuggestions.contains(e.target) && !document.getElementById("postLocation").contains(e.target)) {
      postLocationSuggestions.classList.add("hidden");
    }
  });
  
  async function getUserByUsername(username) {
    const cacheKey = `username:${username}`;
    const cachedUser = getCachedUser(cacheKey);
    if (cachedUser) {
      console.log(`Cache hit for @${username}`);
      return cachedUser;
    }
  
    try {
      const q = query(collection(db, "users"), where("username", "==", username), limit(1));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        console.log(`No user found for @${username}`);
        return null;
      }
      const userData = snapshot.docs[0].data();
      const uid = snapshot.docs[0].id;
      const fullUserData = await fetchUserData(uid); // Assuming this caches UID-based too
      setCachedUser(cacheKey, fullUserData); // Store with 1-hour TTL
      return fullUserData;
    } catch (error) {
      console.error(`Error fetching user @${username}:`, error);
      return null;
    }
  }
  
  async function processMentions(text) {
    const mentionRegex = /@(\w+)/g;
    let processedText = text;
    const matches = [...text.matchAll(mentionRegex)];
  
    if (matches.length === 0) return processedText;
  
    const uniqueUsernames = [...new Set(matches.map(match => match[1]))];
    console.log("Unique mentions found:", uniqueUsernames);
  
    const cachedUsers = {};
    const uncachedUsernames = [];
    uniqueUsernames.forEach(username => {
      const cacheKey = `username:${username}`;
      const cachedUser = getCachedUser(cacheKey);
      if (cachedUser) {
        cachedUsers[username] = cachedUser;
      } else {
        uncachedUsernames.push(username);
      }
    });
  
    const fetchedUsers = {};
    if (uncachedUsernames.length > 0) {
      try {
        const q = query(collection(db, "users"), where("username", "in", uncachedUsernames.slice(0, 10)));
        const snapshot = await getDocs(q);
        snapshot.docs.forEach(doc => {
          const userData = doc.data();
          const uid = doc.id;
          fetchedUsers[userData.username] = { uid, ...userData };
          setCachedUser(`username:${userData.username}`, fetchedUsers[userData.username]);
        });
  
        const remainingUsernames = uncachedUsernames.filter(username => !fetchedUsers[username]).slice(0, 10);
        if (remainingUsernames.length > 0) {
          const q2 = query(collection(db, "users"), where("username", "in", remainingUsernames));
          const snapshot2 = await getDocs(q2);
          snapshot2.docs.forEach(doc => {
            const userData = doc.data();
            const uid = doc.id;
            fetchedUsers[userData.username] = { uid, ...userData };
            setCachedUser(`username:${userData.username}`, fetchedUsers[userData.username]);
          });
        }
      } catch (error) {
        console.error("Error batch fetching users:", error);
      }
    }
  
    const allUsers = { ...cachedUsers, ...fetchedUsers };
    console.log("All users for mentions:", allUsers);
  
    for (const match of matches) {
      const username = match[1];
      const user = allUsers[username];
      if (user) {
        processedText = processedText.replace(
          `@${username}`,
          `<a href="#" class="mention" data-uid="${user.uid}">@${username}</a>`
        );
      }
    }
  
    return processedText;
  }
  
  async function toggleComments(postId) {
    const commentsDiv = document.getElementById(`comments-${postId}`);
    const toggleLink = document.getElementById(`toggleComments-${postId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(auth.currentUser.uid) || commData.creatorId === auth.currentUser.uid;
  
    if (!commentsDiv.dataset.loaded) {
      commentsDiv.style.display = "block";
      toggleLink.textContent = "Hide comments";
      commentsDiv.innerHTML = '<div class="loading">Loading...</div>';
  
      const q = query(
        collection(db, "communities", communityId, "posts", postId, "comments"),
        orderBy("createdAt", "desc"),
        limit(itemsPerPage)
      );
      const snapshot = await getDocs(q);
      commentsDiv.innerHTML = "";
  
      let lastCommentDoc = snapshot.docs[snapshot.docs.length - 1];
      const totalCommentsCount = await totalComments(postId);
  
      for (const doc of snapshot.docs) {
        await renderComment(doc, commentsDiv, postId, isAdmin);
      }
  
      if (commentsDiv.children.length < totalCommentsCount) {
        const seeMoreBtn = document.createElement("button");
        seeMoreBtn.textContent = "See more comments";
        seeMoreBtn.className = "see-more-btn";
        seeMoreBtn.dataset.postId = postId;
        seeMoreBtn.dataset.lastDocId = lastCommentDoc ? lastCommentDoc.id : "";
        seeMoreBtn.addEventListener("click", loadMoreComments);
        commentsDiv.appendChild(seeMoreBtn);
      }
  
      commentsDiv.dataset.loaded = "true";
      commentsDiv.dataset.totalComments = totalCommentsCount;
      toggleLink.textContent = `${totalCommentsCount} comments`;
    } else if (commentsDiv.style.display === "none") {
      commentsDiv.style.display = "block";
      toggleLink.textContent = "Hide comments";
    } else {
      commentsDiv.style.display = "none";
      toggleLink.textContent = `${commentsDiv.dataset.totalComments || await totalComments(postId)} comments`;
    }
  }
  
  async function loadMoreComments(event) {
    const seeMoreBtn = event.target;
    const postId = seeMoreBtn.dataset.postId;
    const lastDocId = seeMoreBtn.dataset.lastDocId;
    const commentsDiv = document.getElementById(`comments-${postId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(auth.currentUser.uid) || commData.creatorId === auth.currentUser.uid;
  
    seeMoreBtn.textContent = "Loading...";
    seeMoreBtn.disabled = true;
  
    // Fetch the last doc we loaded
    let lastDoc = null;
    if (lastDocId) {
      lastDoc = await getDoc(doc(db, "communities", communityId, "posts", postId, "comments", lastDocId));
    }
  
    const q = query(
      collection(db, "communities", communityId, "posts", postId, "comments"),
      orderBy("createdAt", "desc"),
      startAfter(lastDoc),
      limit(itemsPerPage)
    );
    const snapshot = await getDocs(q);
  
    // Remove the old button
    seeMoreBtn.remove();
  
    // Append new comments
    for (const doc of snapshot.docs) {
      await renderComment(doc, commentsDiv, postId, isAdmin);
    }
  
    // Update last doc and check if more remain
    const lastCommentDoc = snapshot.docs[snapshot.docs.length - 1];
    const totalCommentsCount = parseInt(commentsDiv.dataset.totalComments, 10);
    if (commentsDiv.children.length < totalCommentsCount) {
      const newSeeMoreBtn = document.createElement("button");
      newSeeMoreBtn.textContent = "See more comments";
      newSeeMoreBtn.className = "see-more-btn";
      newSeeMoreBtn.dataset.postId = postId;
      newSeeMoreBtn.dataset.lastDocId = lastCommentDoc ? lastCommentDoc.id : "";
      newSeeMoreBtn.addEventListener("click", loadMoreComments);
      commentsDiv.appendChild(newSeeMoreBtn);
    }
  
    // Update toggle link count (just in case)
    document.getElementById(`toggleComments-${postId}`).textContent = `${totalCommentsCount} comments`;
  }
  
  async function renderComment(doc, commentsDiv, postId, isAdmin) {
    const comment = doc.data();
    const userData = await fetchUserData(comment.userId);
    const commData = await getCommData();
    const isCommentAdmin = commData.admins?.includes(comment.userId) || commData.creatorId === comment.userId;
  
    const commentText = await processMentions(comment.text);
    const timestamp = new Date(comment.createdAt.toDate()).toLocaleString();
    const repliesQ = query(collection(db, "communities", communityId, "posts", postId, "comments", doc.id, "replies"), orderBy("createdAt", "desc"));
    const repliesSnapshot = await getDocs(repliesQ);
    const replyCount = repliesSnapshot.size;
  
    const commentDiv = document.createElement("div");
    commentDiv.className = "comment-bubble";
    commentDiv.innerHTML = `
      <div class="comment-content">
        <img loading="lazy" src="${userData.profilePhoto || 'https://via.placeholder.com/30'}" class="profile-photo" alt="Profile">
        <div class="comment-text">
          <span class="username" data-uid="${comment.userId}">${userData.name}</span> ${isCommentAdmin ? '<span class="admin-tag">Admin</span>' : ''}
          <p>${commentText}</p>
          <span class="timestamp">${timestamp}</span>
          <div class="comment-actions">
            <a href="#" class="reply-count" id="toggleReplies-${doc.id}">View ${replyCount} replies</a>
            <button class="reply-btn" id="replyBtn-${doc.id}">Reply</button>
            ${isAdmin || comment.userId === auth.currentUser.uid ? `<button class="delete-comment-btn" id="deleteComment-${doc.id}">Delete</button>` : ""}
          </div>
        </div>
      </div>
      <div class="replies-thread" id="replies-${doc.id}" style="display: none;"></div>
      <form id="replyForm-${doc.id}" class="reply-form hidden">
        <div class="replying-to">Replying to ${userData.name}'s comment <button type="button" class="cancel-reply">Cancel</button></div>
        <textarea placeholder="Your reply..." required></textarea>
        <div id="tagSuggestions-${doc.id}-${doc.id}" class="suggestions hidden"></div>
        <button type="submit">Reply</button>
      </form>
    `;
    commentsDiv.appendChild(commentDiv);
  
    // Add click listeners to all username elements (including mentions)
    commentDiv.querySelectorAll(`.username`).forEach(el => {
      const uid = el.dataset.uid;
      el.addEventListener("click", () => viewProfile(uid));
    });
    commentDiv.querySelectorAll(`.mention`).forEach(el => {
      const uid = el.dataset.uid;
      el.addEventListener("click", (e) => {
        e.preventDefault();
        viewProfile(uid);
      });
    });
  
    const replyBtn = commentDiv.querySelector(`#replyBtn-${doc.id}`);
    replyBtn.addEventListener("click", () => {
      const replyForm = commentDiv.querySelector(`#replyForm-${doc.id}`);
      replyForm.classList.toggle("hidden");
      if (!replyForm.classList.contains("hidden")) replyForm.querySelector("textarea").focus();
    });
    commentDiv.querySelector(`#replyForm-${doc.id}`).addEventListener("submit", (e) => {
      e.preventDefault();
      addReply(postId, doc.id, comment.userId);
    });
    commentDiv.querySelector(`.cancel-reply`).addEventListener("click", () => {
      commentDiv.querySelector(`#replyForm-${doc.id}`).classList.add("hidden");
    });
    const toggleReplies = commentDiv.querySelector(`#toggleReplies-${doc.id}`);
    if (toggleReplies) { // This will always be true now
      toggleReplies.addEventListener("click", (e) => {
        e.preventDefault();
        toggleRepliesFn(postId, doc.id);
      });
    }
    const deleteBtn = commentDiv.querySelector(`#deleteComment-${doc.id}`);
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => deleteComment(postId, doc.id));
    }
  }
  
  async function toggleRepliesFn(postId, commentId) {
    const repliesDiv = document.getElementById(`replies-${commentId}`);
    const toggleLink = document.getElementById(`toggleReplies-${commentId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(auth.currentUser.uid) || commData.creatorId === auth.currentUser.uid;
  
    if (!repliesDiv.dataset.loaded) {
      repliesDiv.style.display = "block";
      toggleLink.textContent = "Hide replies";
      repliesDiv.innerHTML = '<div class="loading">Loading...</div>';
  
      const q = query(
        collection(db, "communities", communityId, "posts", postId, "comments", commentId, "replies"),
        orderBy("createdAt", "desc"),
        limit(itemsPerPage)
      );
      const snapshot = await getDocs(q);
      repliesDiv.innerHTML = "";
  
      let lastReplyDoc = snapshot.docs[snapshot.docs.length - 1];
      const totalRepliesCount = await totalReplies(postId, commentId);
  
      for (const doc of snapshot.docs) {
        await renderReply(doc, repliesDiv, postId, commentId, isAdmin);
      }
  
      if (repliesDiv.children.length < totalRepliesCount) {
        const seeMoreBtn = document.createElement("button");
        seeMoreBtn.textContent = "See more replies";
        seeMoreBtn.className = "see-more-btn";
        seeMoreBtn.dataset.postId = postId;
        seeMoreBtn.dataset.commentId = commentId;
        seeMoreBtn.dataset.lastDocId = lastReplyDoc ? lastReplyDoc.id : "";
        seeMoreBtn.addEventListener("click", loadMoreReplies);
        repliesDiv.appendChild(seeMoreBtn);
      }
  
      repliesDiv.dataset.loaded = "true";
      repliesDiv.dataset.totalReplies = totalRepliesCount;
    } else if (repliesDiv.style.display === "none") {
      repliesDiv.style.display = "block";
      toggleLink.textContent = "Hide replies";
    } else {
      repliesDiv.style.display = "none";
      toggleLink.textContent = `View ${repliesDiv.dataset.totalReplies} replies`;
    }
  }
  
  async function loadMoreReplies(event) {
    const seeMoreBtn = event.target;
    const postId = seeMoreBtn.dataset.postId;
    const commentId = seeMoreBtn.dataset.commentId;
    const lastDocId = seeMoreBtn.dataset.lastDocId;
    const repliesDiv = document.getElementById(`replies-${commentId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(auth.currentUser.uid) || commData.creatorId === auth.currentUser.uid;
  
    seeMoreBtn.textContent = "Loading...";
    seeMoreBtn.disabled = true;
  
    // Fetch the last doc we loaded
    let lastDoc = null;
    if (lastDocId) {
      lastDoc = await getDoc(doc(db, "communities", communityId, "posts", postId, "comments", commentId, "replies", lastDocId));
    }
  
    const q = query(
      collection(db, "communities", communityId, "posts", postId, "comments", commentId, "replies"),
      orderBy("createdAt", "desc"),
      startAfter(lastDoc),
      limit(itemsPerPage)
    );
    const snapshot = await getDocs(q);
  
    // Remove the old button
    seeMoreBtn.remove();
  
    // Append new replies
    for (const doc of snapshot.docs) {
      await renderReply(doc, repliesDiv, postId, commentId, isAdmin);
    }
  
    // Update last doc and check if more remain
    const lastReplyDoc = snapshot.docs[snapshot.docs.length - 1];
    const totalRepliesCount = parseInt(repliesDiv.dataset.totalReplies, 10);
    if (repliesDiv.children.length < totalRepliesCount) {
      const newSeeMoreBtn = document.createElement("button");
      newSeeMoreBtn.textContent = "See more replies";
      newSeeMoreBtn.className = "see-more-btn";
      newSeeMoreBtn.dataset.postId = postId;
      newSeeMoreBtn.dataset.commentId = commentId;
      newSeeMoreBtn.dataset.lastDocId = lastReplyDoc ? lastReplyDoc.id : "";
      newSeeMoreBtn.addEventListener("click", loadMoreReplies);
      repliesDiv.appendChild(newSeeMoreBtn);
    }
  
    // Update toggle link count (just in case)
    const toggleLink = document.getElementById(`toggleReplies-${commentId}`);
    if (toggleLink) toggleLink.textContent = `View ${totalRepliesCount} replies`;
  }
  
      async function renderReply(doc, repliesDiv, postId, commentId, isAdmin) {
    const reply = doc.data();
    const userData = await fetchUserData(reply.userId);
    const commData = await getCommData();
    const isReplyAdmin = commData.admins?.includes(reply.userId) || commData.creatorId === reply.userId;
  
    // Process @mentions into clickable links
    const replyText = await processMentions(reply.text);
  
    const timestamp = new Date(reply.createdAt.toDate()).toLocaleString();
  
    const replyDiv = document.createElement("div");
    replyDiv.className = "reply-bubble";
    replyDiv.innerHTML = `
      <img loading="lazy" src="${userData.profilePhoto || 'https://via.placeholder.com/25'}" class="profile-photo" alt="Profile">
      <div class="reply-text">
        <span class="username" data-uid="${reply.userId}">${userData.name}</span> ${isReplyAdmin ? '<span class="admin-tag">Admin</span>' : ''}
        <p>${replyText}</p>
        <span class="timestamp">${timestamp}</span>
        ${isAdmin || reply.userId === auth.currentUser.uid ? `<button class="delete-reply-btn" id="deleteReply-${doc.id}">Delete</button>` : ""}
      </div>
    `;
    repliesDiv.appendChild(replyDiv);
  
    // Add click listeners to all username elements (including mentions)
    replyDiv.querySelectorAll(`.username`).forEach(el => {
      const uid = el.dataset.uid;
      el.addEventListener("click", () => viewProfile(uid));
    });
    replyDiv.querySelectorAll(`.mention`).forEach(el => {
      const uid = el.dataset.uid;
      el.addEventListener("click", (e) => {
        e.preventDefault(); // Prevent the default <a> behavior
        viewProfile(uid);
      });
    });
  
    const deleteBtn = replyDiv.querySelector(`#deleteReply-${doc.id}`);
    if (deleteBtn) {
      deleteBtn.addEventListener("click", () => deleteReply(postId, commentId, doc.id));
    }
  }
  
      async function deleteComment(postId, commentId) {
        const user = auth.currentUser;
        const commData = await getCommData();
        const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
        const commentRef = doc(db, "communities", communityId, "posts", postId, "comments", commentId);
        const commentDoc = await getDoc(commentRef);
        const commentData = commentDoc.data();
  
        if (!isAdmin && commentData.userId !== user.uid) {
          alert("You can’t delete this comment!");
          return;
        }
  
        if (confirm("Are you sure you want to delete this comment?")) {
          await deleteDoc(commentRef);
          toggleComments(postId);
        }
      }
  
      async function deleteReply(postId, commentId, replyId) {
    const user = auth.currentUser;
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
    const replyRef = doc(db, "communities", communityId, "posts", postId, "comments", commentId, "replies", replyId);
    const replyDoc = await getDoc(replyRef);
    const replyData = replyDoc.data();
  
    if (!isAdmin && replyData.userId !== user.uid) {
      alert("You can’t delete this reply!");
      return;
    }
  
    if (confirm("Are you sure you want to delete this reply?")) {
      await deleteDoc(replyRef);
      console.log(`Deleted reply ${replyId} from comment ${commentId}`);
  
      // Fake decrement in UI
      const repliesDiv = document.getElementById(`replies-${commentId}`);
      const toggleLink = document.getElementById(`toggleReplies-${commentId}`);
      const oldCount = parseInt(repliesDiv.dataset.totalReplies || "0", 10);
      const tempCount = Math.max(0, oldCount - 1);
      repliesDiv.dataset.totalReplies = tempCount;
      toggleLink.textContent = repliesDiv.style.display === "none" ? `View ${tempCount} replies` : "Hide replies";
  
      // Sync with server
      setTimeout(async () => {
        const realCount = await totalReplies(postId, commentId);
        repliesDiv.dataset.totalReplies = realCount;
        toggleLink.textContent = repliesDiv.style.display === "none" ? `View ${realCount} replies` : "Hide replies";
        console.log(`Synced replyCount after delete: ${realCount}`);
      }, 1000);
  
      // Refresh replies UI (optional)
      toggleRepliesFn(postId, commentId);
    }
  }
  
  async function addComment(postId, postOwnerId) {
    const user = auth.currentUser;
    const text = document.getElementById(`commentForm-${postId}`).querySelector("textarea").value.trim();
    if (!text) return;
  
    const commentsDiv = document.getElementById(`comments-${postId}`);
    const toggleLink = document.getElementById(`toggleComments-${postId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
  
    try {
      const commentDoc = await addDoc(collection(db, "communities", communityId, "posts", postId, "comments"), {
        text,
        userId: user.uid,
        createdAt: new Date()
      });
  
      // UI update
      const userData = await fetchCurrentUserData();
      const isCommentAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
      const commentText = await processMentions(text);
      const timestamp = new Date().toLocaleString();
      const newCommentDiv = document.createElement("div");
      newCommentDiv.className = "comment-bubble";
      newCommentDiv.innerHTML = `
        <div class="comment-content">
          <img loading="lazy" src="${userData.profilePhoto || 'https://via.placeholder.com/30'}" class="profile-photo" alt="Profile">
          <div class="comment-text">
            <span class="username" data-uid="${user.uid}">${userData.name}</span> ${isCommentAdmin ? '<span class="admin-tag">Admin</span>' : ''}
            <p>${commentText}</p>
            <span class="timestamp">${timestamp}</span>
            <div class="comment-actions">
              <button class="reply-btn" id="replyBtn-${commentDoc.id}">Reply</button>
              ${isAdmin || user.uid === user.uid ? `<button class="delete-comment-btn" id="deleteComment-${commentDoc.id}">Delete</button>` : ""}
            </div>
          </div>
        </div>
        <div class="replies-thread" id="replies-${commentDoc.id}" style="display: none;"></div>
        <form id="replyForm-${commentDoc.id}" class="reply-form hidden">
          <div class="replying-to">Replying to ${userData.name}'s comment <button type="button" class="cancel-reply">Cancel</button></div>
          <textarea placeholder="Your reply..." required></textarea>
          <div id="tagSuggestions-${commentDoc.id}-${commentDoc.id}" class="suggestions hidden"></div>
          <button type="submit">Reply</button>
        </form>
      `;
  
      if (commentsDiv.style.display !== "none") {
        commentsDiv.insertBefore(newCommentDiv, commentsDiv.firstChild);
      } else {
        commentsDiv.style.display = "block";
        commentsDiv.innerHTML = "";
        commentsDiv.appendChild(newCommentDiv);
        toggleLink.textContent = "Hide comments";
      }
  
      // Event listeners
      newCommentDiv.querySelectorAll(".username").forEach(el => el.addEventListener("click", () => viewProfile(user.uid)));
      newCommentDiv.querySelectorAll(".mention").forEach(el => {
        const uid = el.dataset.uid;
        el.addEventListener("click", (e) => {
          e.preventDefault();
          viewProfile(uid);
        });
      });
      const replyBtn = newCommentDiv.querySelector(`#replyBtn-${commentDoc.id}`);
      replyBtn.addEventListener("click", () => {
        const replyForm = newCommentDiv.querySelector(`#replyForm-${commentDoc.id}`);
        replyForm.classList.toggle("hidden");
        if (!replyForm.classList.contains("hidden")) replyForm.querySelector("textarea").focus();
      });
      newCommentDiv.querySelector(`#replyForm-${commentDoc.id}`).addEventListener("submit", (e) => {
        e.preventDefault();
        addReply(postId, commentDoc.id, user.uid);
      });
      newCommentDiv.querySelector(".cancel-reply").addEventListener("click", () => {
        newCommentDiv.querySelector(`#replyForm-${commentDoc.id}`).classList.add("hidden");
      });
      const deleteBtn = newCommentDiv.querySelector(`#deleteComment-${commentDoc.id}`);
      if (deleteBtn) deleteBtn.addEventListener("click", () => deleteComment(postId, commentDoc.id));
  
      // Send notification and increment unseenCount (client-side)
      if (user.uid !== postOwnerId) {
        const commenterData = await fetchCurrentUserData();
        await addDoc(collection(db, "users", postOwnerId, "notifications"), {
          type: "new_comment",
          message: `${commenterData.name || "Someone"} commented on your post: "${text.substring(0, 50)}..."`,
          postId,
          communityId,
          commentId: commentDoc.id,
          timestamp: new Date(),
          seen: false
        });
  
        const ownerRef = doc(db, "users", postOwnerId);
        await runTransaction(db, async (transaction) => {
          const ownerDoc = await transaction.get(ownerRef);
          const currentCount = ownerDoc.exists() ? ownerDoc.data().unseenCount || 0 : 0;
          transaction.set(ownerRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
          console.log(`Client: Incremented unseenCount for ${postOwnerId} to ${currentCount + 1}`);
        });
        setTimeout(() => updateNotificationBadge(postOwnerId, true), 1000);
      }
  
      // Local comment count update, then sync
      let currentCount = parseInt(commentsDiv.dataset.totalComments || "0", 10);
      currentCount += 1;
      commentsDiv.dataset.totalComments = currentCount;
      toggleLink.textContent = `${currentCount} comments`;
      setTimeout(async () => {
        const realCount = await totalComments(postId);
        commentsDiv.dataset.totalComments = realCount;
        toggleLink.textContent = `${realCount} comments`;
      }, 1000);
  
      document.getElementById(`commentForm-${postId}`).reset();
    } catch (error) {
      console.error("Error adding comment:", error);
    }
  }
  
  async function addReply(postId, commentId, commentOwnerId) {
    const user = auth.currentUser;
    const text = document.getElementById(`replyForm-${commentId}`).querySelector("textarea").value.trim();
    if (!text) return;
  
    const repliesDiv = document.getElementById(`replies-${commentId}`);
    const toggleLink = document.getElementById(`toggleReplies-${commentId}`);
    const commData = await getCommData();
    const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
  
    try {
      const replyDoc = await addDoc(collection(db, "communities", communityId, "posts", postId, "comments", commentId, "replies"), {
        text,
        userId: user.uid,
        createdAt: new Date()
      });
      console.log(`Added reply ${replyDoc.id} to comment ${commentId}`);
  
      // UI update
      const userData = await fetchCurrentUserData();
      const isReplyAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
      const replyText = await processMentions(text);
      const timestamp = new Date().toLocaleString();
      const newReplyDiv = document.createElement("div");
      newReplyDiv.className = "reply-bubble";
      newReplyDiv.innerHTML = `
        <img loading="lazy" src="${userData.profilePhoto || 'https://via.placeholder.com/25'}" class="profile-photo" alt="Profile">
        <div class="reply-text">
          <span class="username" data-uid="${user.uid}">${userData.name}</span> ${isReplyAdmin ? '<span class="admin-tag">Admin</span>' : ''}
          <p>${replyText}</p>
          <span class="timestamp">${timestamp}</span>
          ${isAdmin || user.uid === user.uid ? `<button class="delete-reply-btn" id="deleteReply-${replyDoc.id}">Delete</button>` : ""}
        </div>
      `;
  
      if (repliesDiv.style.display !== "none") {
        repliesDiv.insertBefore(newReplyDiv, repliesDiv.firstChild);
      } else {
        repliesDiv.style.display = "block";
        repliesDiv.innerHTML = "";
        repliesDiv.appendChild(newReplyDiv);
        toggleLink.textContent = "Hide replies";
      }
  
      // Event listeners
      newReplyDiv.querySelectorAll(".username").forEach(el => el.addEventListener("click", () => viewProfile(user.uid)));
      newReplyDiv.querySelectorAll(".mention").forEach(el => {
        const uid = el.dataset.uid;
        el.addEventListener("click", (e) => {
          e.preventDefault();
          viewProfile(uid);
        });
      });
      const deleteBtn = newReplyDiv.querySelector(`#deleteReply-${replyDoc.id}`);
      if (deleteBtn) deleteBtn.addEventListener("click", () => deleteReply(postId, commentId, replyDoc.id));
  
      // Send notification and increment unseenCount (client-side)
      if (user.uid !== commentOwnerId) {
        const replierData = await fetchCurrentUserData();
        await addDoc(collection(db, "users", commentOwnerId, "notifications"), {
          type: "new_reply",
          message: `${replierData.name || "Someone"} replied to your comment: "${text.substring(0, 50)}..."`,
          postId,
          communityId,
          commentId,
          replyId: replyDoc.id,
          timestamp: new Date(),
          seen: false
        });
  
        const ownerRef = doc(db, "users", commentOwnerId);
        await runTransaction(db, async (transaction) => {
          const ownerDoc = await transaction.get(ownerRef);
          const currentCount = ownerDoc.exists() ? ownerDoc.data().unseenCount || 0 : 0;
          transaction.set(ownerRef, { unseenCount: currentCount + 1, lastUpdated: new Date() }, { merge: true });
          console.log(`Client: Incremented unseenCount for ${commentOwnerId} to ${currentCount + 1}`);
        });
        setTimeout(() => updateNotificationBadge(commentOwnerId, true), 1000);
      }
  
      // Local reply count update, then sync
      const oldCount = parseInt(repliesDiv.dataset.totalReplies || "0", 10);
      const tempCount = oldCount + 1;
      repliesDiv.dataset.totalReplies = tempCount;
      toggleLink.textContent = repliesDiv.style.display === "none" ? `View ${tempCount} replies` : "Hide replies";
      console.log(`Faked replyCount to ${tempCount} for UI`);
  
      setTimeout(async () => {
        const realCount = await totalReplies(postId, commentId);
        repliesDiv.dataset.totalReplies = realCount;
        toggleLink.textContent = repliesDiv.style.display === "none" ? `View ${realCount} replies` : "Hide replies";
        console.log(`Synced replyCount with server: ${realCount}`);
      }, 1000);
  
      document.getElementById(`replyForm-${commentId}`).reset();
      document.getElementById(`replyForm-${commentId}`).classList.add("hidden");
    } catch (error) {
      console.error("Error adding reply:", error);
    }
  }

  // Cloud function helper: exports.onCommentChange = onDocumentWritten(
  async function totalComments(postId) {
  const postRef = doc(db, "communities", communityId, "posts", postId);
  const postDoc = await getDoc(postRef);
  if (postDoc.exists) {
  return postDoc.data().commentCount || 0; // If no comments yet, return 0
  }
  return 0; // Post doesn’t exist
  }
  
  // Cloud function helper: exports.onReplyChange = onDocumentWritten(
  async function totalReplies(postId, commentId) {
  const commentRef = doc(db, "communities", communityId, "posts", postId, "comments", commentId);
  const commentDoc = await getDoc(commentRef);
  if (commentDoc.exists) {
  return commentDoc.data().replyCount || 0; // If no replies yet, return 0
  }
  return 0; // Comment doesn’t exist
  }

  window.toggleComments = toggleComments;
  window.addComment = addComment;
  window.showTagSuggestions = showTagSuggestions;
  window.getUserByUsername = getUserByUsername;
  window.totalComments = totalComments;
  window.totalReplies = totalComments;
  window.addReply = addReply;
  window.deleteReply = deleteReply;
  window.deleteComment = deleteComment;
  window.toggleRepliesFn = toggleRepliesFn;
  window.renderComment = renderComment;
  window.processMentions = processMentions;
  window.loadMoreReplies = loadMoreReplies;
  window.loadMoreComments = loadMoreComments;