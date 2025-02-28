import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, where, getDocs, addDoc, doc, getDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const auth = getAuth();
const db = getFirestore();
const storage = getStorage();

let communityId;
let userId;
let storyCache = new Map();
let lastFetchTime = 0;
let lastFetchedTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

document.addEventListener("DOMContentLoaded", () => {
    onAuthStateChanged(auth, (user) => {
        if (user) {
            userId = user.uid;
            const urlParams = new URLSearchParams(window.location.search);
            communityId = urlParams.get("id");
            if (!communityId) {
                console.error("No community ID found in URL!");
                return;
            }
            initializeStories();
        } else {
            window.location.href = "/login.html";
        }
    });
});

async function initializeStories() {
    await loadStories();
    setupAddStoryForm();
    setupStoryModal();
    document.getElementById("refreshStoriesBtn").addEventListener("click", () => loadStories(true));
}

async function loadStories(forceRefresh = false) {
    try {
        const now = Date.now();
        const storiesWrapper = document.getElementById("storiesWrapper");
        if (!storiesWrapper) throw new Error("storiesWrapper not found!");
        storiesWrapper.innerHTML = "";

        if (!forceRefresh && now - lastFetchTime < CACHE_TTL && storyCache.size > 0) {
            console.log(`[Cache Hit] Using ${storyCache.size} cached stories`);
            renderStories([...storyCache.values()]);
            return;
        }

        const storiesRef = collection(db, "stories");
        const q = query(
            storiesRef,
            where("communityId", "==", communityId),
            where("timestamp", ">", lastFetchedTimestamp ? new Date(lastFetchedTimestamp) : new Date(now - 24 * 60 * 60 * 1000))
        );
        const snapshot = await getDocs(q);
        const newStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        console.log(`[Fetch] Got ${newStories.length} new stories`);
        newStories.forEach(story => storyCache.set(story.id, story));
        lastFetchTime = now;
        lastFetchedTimestamp = Math.max(...newStories.map(s => s.timestamp.toMillis()), lastFetchedTimestamp);

        const allStories = [...storyCache.values()]
            .filter(story => story.timestamp.toMillis() > now - 24 * 60 * 60 * 1000)
            .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

        console.log(`[Render] Total stories: ${allStories.length}`);
        renderStories(allStories);
    } catch (error) {
        console.error("[Error] Loading stories:", error);
        alert("Failed to load stories, bro!");
    }
}

function renderStories(stories) {
    const storiesWrapper = document.getElementById("storiesWrapper");
    if (!storiesWrapper) return;
    storiesWrapper.innerHTML = "";

    if (stories.length === 0) {
        storiesWrapper.innerHTML = "<p>No stories yet, bro!</p>";
        return;
    }

    const userStories = {};
    stories.forEach(story => {
        if (!userStories[story.userId]) userStories[story.userId] = [];
        userStories[story.userId].push(story);
    });

    Object.keys(userStories).forEach(userId => {
        const storiesForUser = userStories[userId];
        const latestStory = storiesForUser.sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis())[0];
        const username = latestStory.username.length > 10 ? `${latestStory.username.slice(0, 7)}...` : latestStory.username;
        const hasUnviewed = storiesForUser.some(story => !story.viewedBy.includes(userId));

        const slide = document.createElement("div");
        slide.className = "swiper-slide";
        slide.innerHTML = `
            <img src="${latestStory.userProfilePhoto || 'https://via.placeholder.com/60'}" 
                 alt="Profile" 
                 class="story-profile ${hasUnviewed ? '' : 'viewed'}" 
                 data-user-id="${userId}">
            <span class="clickable2" data-user-id="${userId}">${username}</span>
        `;
        storiesWrapper.appendChild(slide);
        slide.querySelector(".story-profile").addEventListener("click", () => viewStory(userId));
        slide.querySelector("span").addEventListener("click", () => viewProfile(userId));
    });

    console.log("[Swiper] Initializing outer Swiper");
    new Swiper('.swiper-container', {
        slidesPerView: window.innerWidth < 768 ? 3 : 5,
        spaceBetween: 10,
        navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        loop: true,
    });
}

async function viewStory(userId) {
    try {
        console.log("[View] Viewing stories for user:", userId);
        const userStories = [...storyCache.values()]
            .filter(s => s.userId === userId && s.timestamp.toMillis() > Date.now() - 24 * 60 * 60 * 1000)
            .sort((a, b) => a.timestamp.toMillis() - b.timestamp.toMillis());

        if (userStories.length === 0) {
            console.error("[View] No stories found for user:", userId);
            alert("No stories found!");
            return;
        }

        const modal = document.getElementById("storyModal");
        if (!modal) throw new Error("storyModal not found!");
        const storyPhotosWrapper = document.getElementById("storyPhotosWrapper");
        if (!storyPhotosWrapper) throw new Error("storyPhotosWrapper not found!");
        const storyUsername = document.getElementById("storyUsername");
        const storyTimestamp = document.getElementById("storyTimestamp");
        const storyText = document.getElementById("storyText");
        const viewPostBtn = document.getElementById("viewPostBtn");
        const editBtn = document.getElementById("editStoryBtn");
        const deleteBtn = document.getElementById("deleteStoryBtn");
        const prevBtn = document.getElementById("prevStoryBtn");
        const nextBtn = document.getElementById("nextStoryBtn");

        for (const story of userStories) {
            if (!story.viewedBy.includes(userId)) {
                story.viewedBy.push(userId);
                await updateDoc(doc(db, "stories", story.id), { viewedBy: story.viewedBy });
                storyCache.set(story.id, { ...story, viewedBy: story.viewedBy });
            }
        }
        await loadStories();

        storyUsername.textContent = userStories[0].username;
        storyUsername.onclick = () => viewProfile(userId);

        if (window.innerSwiper) {
            window.innerSwiper.destroy(true, true);
            window.innerSwiper = null;
        }

        storyPhotosWrapper.innerHTML = "";
        userStories.forEach(story => {
            const imageUrls = story.imageUrls || [story.imageUrl];
            imageUrls.forEach((url, index) => {
                const slide = document.createElement("div");
                slide.className = "swiper-slide";
                slide.innerHTML = `
                    <img src="${url}" alt="Story Photo" data-story-id="${story.id}" data-photo-index="${index}">
                    <div class="story-details">
                        <p>${story.text || ""}</p>
                    </div>
                `;
                storyPhotosWrapper.appendChild(slide);
            });
        });

        if (storyPhotosWrapper.children.length > 0) {
            window.innerSwiper = new Swiper('.swiper-container-inner', {
                slidesPerView: 1,
                navigation: { nextEl: '.swiper-button-next-inner', prevEl: '.swiper-button-prev-inner' },
                loop: userStories.length > 1,
                on: {
                    slideChange: () => {
                        const activeSlide = storyPhotosWrapper.querySelector(".swiper-slide-active");
                        if (!activeSlide) return;
                        const storyId = activeSlide.querySelector("img").dataset.storyId;
                        const story = storyCache.get(storyId);
                        if (!story) return;
                        storyTimestamp.textContent = new Date(story.timestamp.toMillis()).toLocaleString();
                        storyText.textContent = story.text || "";
                        if (story.postId) {
                            viewPostBtn.classList.remove("hidden");
                            viewPostBtn.onclick = () => {
                                window.communitySearchPostsById(story.postId);
                                const scrollTarget = document.getElementById("search-scrolldown2");
                                if (scrollTarget) scrollTarget.scrollIntoView({ behavior: "smooth" });
                                closeModal("storyModal");
                            };
                        } else {
                            viewPostBtn.classList.add("hidden");
                        }
                    }
                }
            });
        } else {
            console.warn("No slides to initialize Swiper!");
        }

        const firstStory = userStories[0];
        storyTimestamp.textContent = new Date(firstStory.timestamp.toMillis()).toLocaleString();
        storyText.textContent = firstStory.text || "";
        if (firstStory.postId) {
            viewPostBtn.classList.remove("hidden");
            viewPostBtn.onclick = () => {
                window.communitySearchPostsById(firstStory.postId);
                const scrollTarget = document.getElementById("search-scrolldown2");
                if (scrollTarget) scrollTarget.scrollIntoView({ behavior: "smooth" });
                closeModal("storyModal");
            };
        } else {
            viewPostBtn.classList.add("hidden");
        }

        if (userId === auth.currentUser.uid) {
            editBtn.classList.remove("hidden");
            deleteBtn.classList.remove("hidden");
            editBtn.onclick = () => {
                const activeSlide = storyPhotosWrapper.querySelector(".swiper-slide-active");
                if (!activeSlide) return;
                const storyId = activeSlide.querySelector("img").dataset.storyId;
                const photoIndex = parseInt(activeSlide.querySelector("img").dataset.photoIndex);
                editStory(storyId, photoIndex);
            };
            deleteBtn.onclick = () => deleteStory(firstStory.id, firstStory.imageUrls ? firstStory.imageUrls[0] : firstStory.imageUrl);
            storyPhotosWrapper.querySelectorAll("img").forEach(img => {
                img.addEventListener("click", () => {
                    const storyId = img.dataset.storyId;
                    const photoIndex = parseInt(img.dataset.photoIndex);
                    editStory(storyId, photoIndex);
                });
            });
        } else {
            editBtn.classList.add("hidden");
            deleteBtn.classList.add("hidden");
        }

        const allStories = [...storyCache.values()].filter(s => s.timestamp.toMillis() > Date.now() - 24 * 60 * 60 * 1000);
        const allUsers = [...new Set(allStories.map(s => s.userId))];
        const currentIndex = allUsers.indexOf(userId);
        prevBtn.style.display = allUsers.length > 1 ? "block" : "none";
        nextBtn.style.display = allUsers.length > 1 ? "block" : "none";
        prevBtn.onclick = () => {
            const prevIndex = (currentIndex - 1 + allUsers.length) % allUsers.length;
            viewStory(allUsers[prevIndex]);
        };
        nextBtn.onclick = () => {
            const nextIndex = (currentIndex + 1) % allUsers.length;
            viewStory(allUsers[nextIndex]);
        };

        modal.style.display = "flex";
        modal.classList.remove("hidden");
    } catch (error) {
        console.error("[Error] Viewing story:", error);
        alert("Failed to load story, bro!");
    }
}

function setupStoryModal() {
    const closeBtn = document.getElementById("closeStoryBtn");
    if (closeBtn) closeBtn.addEventListener("click", () => closeModal("storyModal"));
}

async function setupAddStoryForm() {
    const addStoryBtn = document.getElementById("addStoryBtn");
    if (!addStoryBtn) {
        console.error("addStoryBtn not found in the DOM!");
        return;
    }

    addStoryBtn.addEventListener("click", async () => {
        try {
            const userStoriesRef = collection(db, "stories");
            const q = query(
                userStoriesRef,
                where("userId", "==", userId),
                where("communityId", "==", communityId),
                where("timestamp", ">", new Date(Date.now() - 24 * 60 * 60 * 1000))
            );
            const snapshot = await getDocs(q);
            const oldStories = snapshot.docs.filter(doc => doc.data().timestamp.toMillis() < Date.now() - 3 * 60 * 60 * 1000);

            if (snapshot.size >= 3) {
                if (oldStories.length > 0) {
                    alert("You’ve hit the 3-story limit! Delete an old one (over 3 hours) to add a new one.");
                    return;
                } else {
                    alert("You’ve got 3 active stories, bro. Wait for one to expire or delete it!");
                    return;
                }
            }

            const modal = document.getElementById("addStoryModal");
            if (!modal) throw new Error("addStoryModal not found!");
            modal.querySelector("h2").textContent = "Add Story";
            modal.style.display = "flex";
            modal.classList.remove("hidden");

            const fileInput = document.getElementById("storyImageInput");
            const textInput = document.getElementById("storyTextInput");
            const tagPostSelect = document.getElementById("tagPostSelect");
            const uploadBtn = document.getElementById("uploadStoryBtn");
            const cancelBtn = document.getElementById("cancelStoryBtn");

            if (!fileInput || !textInput || !tagPostSelect || !uploadBtn || !cancelBtn) {
                console.error("One or more form elements not found!");
                closeModal("addStoryModal");
                return;
            }

            fileInput.value = "";
            textInput.value = "";
            tagPostSelect.innerHTML = '<option value="">Select a post to tag (optional)</option>';
            uploadBtn.textContent = "Upload Story";

            const postsRef = collection(db, "communities", communityId, "posts");
            const postsQ = query(postsRef, where("userId", "==", userId));
            const postsSnapshot = await getDocs(postsQ);
            postsSnapshot.forEach(doc => {
                const option = document.createElement("option");
                option.value = doc.id;
                option.textContent = doc.data().title;
                tagPostSelect.appendChild(option);
            });

            uploadBtn.onclick = async () => {
                const files = fileInput.files;
                if (files.length === 0) {
                    alert("Please select at least one image, bro!");
                    return;
                }

                const imageUrls = [];
                for (const file of files) {
                    const compressedBlob = await compressImage(file);
                    const storageRef = ref(storage, `stories/${communityId}/${userId}/${Date.now()}.jpg`);
                    await uploadBytes(storageRef, compressedBlob);
                    const imageUrl = await getDownloadURL(storageRef);
                    imageUrls.push(imageUrl);
                }

                const userData = await fetchUserData(userId);
                const storyData = {
                    userId,
                    communityId,
                    imageUrls,
                    timestamp: serverTimestamp(),
                    viewedBy: [],
                    postId: tagPostSelect.value || null,
                    text: textInput.value.trim() || "",
                    username: userData.username,
                    userProfilePhoto: userData.profilePhoto || "https://via.placeholder.com/60"
                };

                const docRef = await addDoc(collection(db, "stories"), storyData);
                storyCache.set(docRef.id, { id: docRef.id, ...storyData });
                console.log("Story uploaded:", storyData);
                alert("Story uploaded, dope!");

                fileInput.value = "";
                textInput.value = "";
                tagPostSelect.value = "";
                closeModal("addStoryModal");
                await loadStories(true);
            };

            cancelBtn.onclick = () => {
                fileInput.value = "";
                textInput.value = "";
                tagPostSelect.value = "";
                closeModal("addStoryModal");
            };
        } catch (error) {
            console.error("Error setting up add story form:", error);
            alert("Something went wrong, try again, bro!");
            closeModal("addStoryModal");
        }
    });
}

async function editStory(storyId, photoIndex) {
    try {
        const story = storyCache.get(storyId);
        if (!story) {
            alert("Story not found, bro!");
            return;
        }

        const modal = document.getElementById("addStoryModal");
        if (!modal) throw new Error("addStoryModal not found!");
        modal.querySelector("h2").textContent = `Edit Story Photo #${photoIndex + 1}`;
        modal.style.display = "flex";
        modal.classList.remove("hidden");

        const fileInput = document.getElementById("storyImageInput");
        const textInput = document.getElementById("storyTextInput");
        const tagPostSelect = document.getElementById("tagPostSelect");
        const uploadBtn = document.getElementById("uploadStoryBtn");
        const cancelBtn = document.getElementById("cancelStoryBtn");

        if (!fileInput || !textInput || !tagPostSelect || !uploadBtn || !cancelBtn) {
            console.error("One or more form elements not found!");
            closeModal("addStoryModal");
            return;
        }

        fileInput.value = "";
        textInput.value = story.text || "";
        tagPostSelect.innerHTML = '<option value="">Select a post to tag (optional)</option>';
        const postsRef = collection(db, "communities", communityId, "posts");
        const postsQ = query(postsRef, where("userId", "==", userId));
        const postsSnapshot = await getDocs(postsQ);
        postsSnapshot.forEach(doc => {
            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = doc.data().title;
            tagPostSelect.appendChild(option);
        });
        tagPostSelect.value = story.postId || "";
        uploadBtn.textContent = "Save Changes";

        const currentPhotoUrl = (story.imageUrls || [story.imageUrl])[photoIndex];
        console.log(`Editing photo at index ${photoIndex}: ${currentPhotoUrl}`);

        uploadBtn.onclick = async () => {
            const file = fileInput.files[0];
            let updatedImageUrls = [...(story.imageUrls || [story.imageUrl])];

            if (file) {
                const compressedBlob = await compressImage(file);
                const storageRef = ref(storage, `stories/${communityId}/${userId}/${Date.now()}.jpg`);
                await uploadBytes(storageRef, compressedBlob);
                const newImageUrl = await getDownloadURL(storageRef);
                if (updatedImageUrls[photoIndex]) {
                    await deleteObject(ref(storage, updatedImageUrls[photoIndex]));
                }
                updatedImageUrls[photoIndex] = newImageUrl;
            }

            const updatedStory = {
                imageUrls: updatedImageUrls,
                text: textInput.value.trim() || "",
                postId: tagPostSelect.value || null
            };

            await updateDoc(doc(db, "stories", storyId), updatedStory);
            storyCache.set(storyId, { ...story, ...updatedStory });
            console.log("Story edited:", { id: storyId, ...updatedStory });
            alert("Story updated, bro!");

            fileInput.value = "";
            textInput.value = "";
            tagPostSelect.value = "";
            closeModal("addStoryModal");
            await loadStories(true);
        };

        cancelBtn.onclick = () => {
            fileInput.value = "";
            textInput.value = "";
            tagPostSelect.value = "";
            closeModal("addStoryModal");
        };
    } catch (error) {
        console.error("Error editing story:", error);
        alert("Failed to edit story, bro!");
        closeModal("addStoryModal");
    }
}

async function deleteStory(storyId, imageUrl) {
    if (!confirm("Delete this story?")) return;

    const overlay = document.getElementById("deleteStoryOverlay");
    if (overlay) {
        overlay.style.display = "flex";
        overlay.classList.remove("hidden");
    }

    try {
        const story = storyCache.get(storyId);
        if (!story) {
            console.error("Story not found in cache:", storyId);
            return;
        }

        if (story.imageUrls) {
            for (const url of story.imageUrls) {
                await deleteObject(ref(storage, url));
            }
        } else if (imageUrl) {
            await deleteObject(ref(storage, imageUrl));
        }
        await deleteDoc(doc(db, "stories", storyId));
        storyCache.delete(storyId);
        console.log("Story deleted:", storyId);
        alert("Story deleted, bro!");

        // Immediately re-render stories from cache
        const remainingStories = [...storyCache.values()]
            .filter(s => s.timestamp.toMillis() > Date.now() - 24 * 60 * 60 * 1000)
            .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());
        renderStories(remainingStories);

        // Close modal and hide overlay
        closeModal("storyModal");
    } catch (error) {
        console.error("Error deleting story:", error);
        alert("Failed to delete story, bro!");
    } finally {
        if (overlay) {
            overlay.style.display = "none";
            overlay.classList.add("hidden");
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add("hidden");
        modal.style.display = "none";
    }
}

async function fetchUserData(uid) {
    try {
        const userRef = doc(db, "users", uid);
        const userDoc = await getDoc(userRef);
        return userDoc.exists() ? userDoc.data() : { username: `user_${uid.slice(0, 8)}`, profilePhoto: null };
    } catch (error) {
        console.error("Error fetching user data:", error);
        return { username: `user_${uid.slice(0, 8)}`, profilePhoto: null };
    }
}

async function compressImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        img.onload = () => {
            const maxWidth = 800;
            const maxHeight = 800;
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.7);
        };
        img.onerror = () => reject(new Error("Image compression failed"));
        img.src = URL.createObjectURL(file);
    });
}

function viewProfile(userId) {
    window.communityViewProfile(userId);
}