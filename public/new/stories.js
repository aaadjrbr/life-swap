import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, query, getDoc, where, orderBy, limit, getDocs, addDoc, doc, updateDoc, deleteDoc, Timestamp, startAfter } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const auth = getAuth();
const db = getFirestore();
const storage = getStorage();

let communityId;
let userId;
let storyCache = new Map();
let viewedStories = new Set();
let lastFetchTime = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let isProcessing = false;
let lastDoc = null; // For pagination

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
    document.getElementById("refreshStoriesBtn")?.addEventListener("click", throttle(() => loadStories(true), 2000)); // Throttled refresh
    document.getElementById("loadMoreBtn")?.addEventListener("click", () => loadStories(false, lastDoc)); // Pagination trigger
}

async function loadStories(forceRefresh = false, lastDocParam = null) {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const now = Date.now();
        const storiesWrapper = document.getElementById("storiesWrapper");
        if (!storiesWrapper) throw new Error("storiesWrapper not found!");

        if (forceRefresh || now - lastFetchTime >= CACHE_TTL || storyCache.size === 0) {
            const storiesRef = collection(db, "communities", communityId, "stories");
            let q = query(
                storiesRef,
                where("timestamp", ">", Timestamp.fromMillis(now - 24 * 60 * 60 * 1000)),
                orderBy("timestamp", "desc"),
                limit(50) // Fetch 50 to have room for shuffling
            );
            if (lastDocParam) q = query(q, startAfter(lastDocParam)); // Paginate if provided

            const snapshot = await getDocs(q);
            const allStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            lastDoc = snapshot.docs[snapshot.docs.length - 1]; // Update pagination cursor

            console.log(`[Fetch] Got ${allStories.length} stories`);

            // Shuffle client-side and take 20
            const shuffledStories = allStories
                .sort(() => Math.random() - 0.5) // Randomize order
                .slice(0, 20); // Limit to 20 for display

            shuffledStories.forEach(story => storyCache.set(story.id, story));
            lastFetchTime = now;

            renderStories(shuffledStories);
        } else {
            console.log(`[Cache Hit] Using ${storyCache.size} cached stories`);
            const validStories = [...storyCache.values()]
                .filter(story => story.timestamp.toMillis() > now - 24 * 60 * 60 * 1000)
                .sort(() => Math.random() - 0.5) // Shuffle cached stories
                .slice(0, 20); // Take 20 from cache
            renderStories(validStories);
        }
    } catch (error) {
        console.error("[Error] Loading stories:", error);
        alert("Failed to load stories, bro!");
    } finally {
        isProcessing = false;
    }
}

function renderStories(stories) {
    const storiesWrapper = document.getElementById("storiesWrapper");
    if (!storiesWrapper) return;

    // Check if re-rendering is needed
    const currentIds = new Set(stories.map(s => s.id));
    const renderedIds = new Set([...storiesWrapper.querySelectorAll(".swiper-slide")].map(slide => slide.querySelector(".story-profile").dataset.storyId));
    if (currentIds.size === renderedIds.size && [...currentIds].every(id => renderedIds.has(id))) {
        console.log("[Render] No changes, skipping");
        return;
    }

    storiesWrapper.innerHTML = stories.length === 0 ? "<p>No stories yet, bro!</p>" : "";

    stories.forEach(story => {
        const hasUnviewed = !viewedStories.has(story.id);
        const slide = document.createElement("div");
        slide.className = "swiper-slide";
        slide.innerHTML = `
            <img src="${story.userProfilePhoto || 'https://via.placeholder.com/60'}" 
                 alt="Profile" 
                 class="story-profile ${hasUnviewed ? '' : 'viewed'}" 
                 data-story-id="${story.id}">
            <span class="clickable2" data-user-id="${story.userId}">${story.username.length > 10 ? `${story.username.slice(0, 7)}...` : story.username}</span>
        `;
        storiesWrapper.appendChild(slide);
        slide.querySelector(".story-profile").addEventListener("click", () => viewStory(story.id));
        slide.querySelector("span").addEventListener("click", () => viewProfile(story.userId));
    });

    if (window.outerSwiper) window.outerSwiper.destroy(true, true);
    window.outerSwiper = new Swiper('.swiper-container', {
        slidesPerView: Math.min(10, stories.length), // Cap at 10 visible
        spaceBetween: 10,
        virtual: true, // Lazy-load slides (if Swiper version supports)
        navigation: { nextEl: '.swiper-button-next', prevEl: '.swiper-button-prev' },
        loop: stories.length > 10, // Loop only if > 10
        loopedSlides: stories.length,
        on: {
            init: () => console.log("Outer Swiper initialized"),
            loopFix: () => console.log("Loop fixed")
        }
    });
}

async function viewStory(storyId) {
    if (isProcessing) return;
    isProcessing = true;
    try {
        console.log("[View] Viewing story:", storyId);
        const now = Date.now();
        const story = storyCache.get(storyId);
        if (!story || !story.images.some(img => img.timestamp.toMillis() > now - 24 * 60 * 60 * 1000)) {
            alert("No story found, bro!");
            return;
        }

        if (!viewedStories.has(storyId)) {
            viewedStories.add(storyId);
            renderStories([...storyCache.values()]);
        }

        const modal = document.getElementById("storyModal");
        const storyPhotosWrapper = document.getElementById("storyPhotosWrapper");
        const storyUsername = document.getElementById("storyUsername");
        const storyTimestamp = document.getElementById("storyTimestamp");
        const storyText = document.getElementById("storyText");
        const viewPostBtn = document.getElementById("viewPostBtn");
        const editBtn = document.getElementById("editStoryBtn");
        const deleteBtn = document.getElementById("deleteStoryBtn");
        const prevBtn = document.getElementById("prevStoryBtn");
        const nextBtn = document.getElementById("nextStoryBtn");

        if (!modal || !storyPhotosWrapper) throw new Error("Modal or photos wrapper missing!");

        storyUsername.textContent = story.username;
        storyUsername.onclick = () => viewProfile(story.userId);

        if (window.innerSwiper) window.innerSwiper.destroy(true, true);
        storyPhotosWrapper.innerHTML = "";
        let totalPhotos = 0;
        let firstValidSlide = true;

        story.images.forEach((img, index) => {
            const isExpired = img.timestamp.toMillis() <= now - 24 * 60 * 60 * 1000;
            if (story.userId !== userId && isExpired) return;
            totalPhotos++;
            const slide = document.createElement("div");
            slide.className = "swiper-slide";
            let slideContent = `
                <img src="${img.imageUrl}" alt="Story Photo" data-story-id="${storyId}" data-photo-index="${index}">
                <div class="story-details">
                    <p>${story.text || ""}</p>
            `;
            if (isExpired && story.userId === userId) {
                slideContent += `<div class="expired-warning">Photo expired (24h+)</div>`;
            } else if (totalPhotos > 1 && firstValidSlide && !isExpired) {
                slideContent += `<div class="slide-hint">Slide to see more</div>`;
                console.log("Slide hint added to first valid photo, total photos:", totalPhotos);
                firstValidSlide = false;
            }
            slideContent += `</div>`;
            slide.innerHTML = slideContent;
            storyPhotosWrapper.appendChild(slide);
        });

        window.innerSwiper = new Swiper('.swiper-container-inner', {
            slidesPerView: 1,
            navigation: { nextEl: '.swiper-button-next-inner', prevEl: '.swiper-button-prev-inner' },
            loop: totalPhotos > 1 && story.userId !== userId,
            on: {
                init: () => {
                    setTimeout(() => {
                        updateSlideDetails();
                        console.log("Swiper initialized and details updated on init");
                    }, 100);
                },
                slideChangeTransitionEnd: debounce(updateSlideDetails, 50)
            }
        });

        function updateSlideDetails() {
            const activeSlide = storyPhotosWrapper.querySelector(".swiper-slide-active");
            if (!activeSlide) {
                console.log("No active slide found yet!");
                return;
            }
            const photoIndex = parseInt(activeSlide.querySelector("img").dataset.photoIndex);
            const imgData = story.images[photoIndex];
            storyTimestamp.textContent = new Date(imgData.timestamp.toMillis()).toLocaleString();
            storyText.textContent = story.text || "";
            viewPostBtn.classList.toggle("hidden", !imgData.postId || imgData.timestamp.toMillis() <= now - 24 * 60 * 60 * 1000);
            if (imgData.postId && imgData.timestamp.toMillis() > now - 24 * 60 * 60 * 1000) {
                viewPostBtn.onclick = () => {
                    window.communitySearchPostsById(imgData.postId);
                    document.getElementById("search-scrolldown2")?.scrollIntoView({ behavior: "smooth" });
                    closeModal("storyModal");
                };
            } else {
                viewPostBtn.onclick = null;
            }
            console.log("Slide details updated - Story:", storyId, "Photo Index:", photoIndex);
        }

        function debounce(func, wait) {
            let timeout;
            return function (...args) {
                clearTimeout(timeout);
                timeout = setTimeout(() => func.apply(this, args), wait);
            };
        }

        if (story.userId === userId) {
            editBtn.classList.remove("hidden");
            deleteBtn.classList.remove("hidden");
            editBtn.onclick = () => {
                if (isProcessing) return;
                const activeSlide = storyPhotosWrapper.querySelector(".swiper-slide-active");
                if (!activeSlide) return;
                editStory(activeSlide.querySelector("img").dataset.storyId, parseInt(activeSlide.querySelector("img").dataset.photoIndex));
            };
            deleteBtn.onclick = () => {
                if (isProcessing) return;
                const activeSlide = storyPhotosWrapper.querySelector(".swiper-slide-active");
                if (!activeSlide) return;
                deleteStory(activeSlide.querySelector("img").dataset.storyId, parseInt(activeSlide.querySelector("img").dataset.photoIndex));
            };
        } else {
            editBtn.classList.add("hidden");
            deleteBtn.classList.add("hidden");
        }

        const allStories = [...storyCache.values()];
        const currentIndex = allStories.findIndex(s => s.id === storyId);
        prevBtn.style.display = allStories.length > 1 ? "block" : "none";
        nextBtn.style.display = allStories.length > 1 ? "block" : "none";
        prevBtn.onclick = () => viewStory(allStories[(currentIndex - 1 + allStories.length) % allStories.length].id);
        nextBtn.onclick = () => viewStory(allStories[(currentIndex + 1) % allStories.length].id);

        modal.style.display = "flex";
        modal.classList.remove("hidden");
    } catch (error) {
        console.error("[Error] Viewing story:", error);
        alert("Failed to load story, bro!");
    } finally {
        isProcessing = false;
    }
}

function setupStoryModal() {
    document.getElementById("closeStoryBtn")?.addEventListener("click", () => closeModal("storyModal"));
}

async function setupAddStoryForm() {
    const addStoryBtn = document.getElementById("addStoryBtn");
    if (!addStoryBtn) return console.error("addStoryBtn not found!");

    addStoryBtn.addEventListener("click", async () => {
        if (isProcessing) return;
        isProcessing = true;
        try {
            const now = Date.now();
            const storiesRef = collection(db, "communities", communityId, "stories");
            const q = query(storiesRef, where("userId", "==", userId));
            const snapshot = await getDocs(q);
            const userStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const expiredStories = userStories.filter(s => s.images.some(img => img.timestamp.toMillis() <= now - 24 * 60 * 60 * 1000));
            const activeImages = userStories.flatMap(s => s.images).filter(img => img.timestamp.toMillis() > now - 24 * 60 * 60 * 1000);

            if (expiredStories.length > 0) {
                alert("You’ve got expired photos (24h+). Delete them before posting new ones, bro!");
                return;
            }
            if (activeImages.length >= 3) {
                alert("Max 3 active photos, bro. Wait for one to expire or delete it!");
                return;
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

            fileInput.value = "";
            textInput.value = "";
            tagPostSelect.innerHTML = '<option value="">Select a post (optional)</option>';
            const postsRef = collection(db, "communities", communityId, "posts");
            const postsSnapshot = await getDocs(query(postsRef, where("userId", "==", userId)));
            postsSnapshot.forEach(doc => {
                const option = document.createElement("option");
                option.value = doc.id;
                option.textContent = doc.data().title;
                tagPostSelect.appendChild(option);
            });
            uploadBtn.textContent = "Upload Story";

            uploadBtn.onclick = async () => {
                if (isProcessing) return;
                isProcessing = true;
                try {
                    if (fileInput.files.length === 0) {
                        alert("Pick an image, bro!");
                        return;
                    }
                    const images = [];
                    const timestamp = Timestamp.now();
                    for (const file of fileInput.files) {
                        const compressedBlob = await compressImage(file);
                        const storageRef = ref(storage, `stories/${communityId}/${userId}/${Date.now()}.jpg`);
                        await uploadBytes(storageRef, compressedBlob);
                        images.push({
                            imageUrl: await getDownloadURL(storageRef),
                            timestamp,
                            postId: tagPostSelect.value || null
                        });
                    }

                    const userData = await fetchUserData(userId);
                    const storyData = {
                        userId,
                        communityId,
                        images,
                        text: textInput.value.trim() || "",
                        username: userData.username,
                        userProfilePhoto: userData.profilePhoto || "https://via.placeholder.com/60",
                        timestamp,
                        randomIndex: Math.floor(Math.random() * 10000) // Add random index for sampling
                    };

                    const docRef = await addDoc(storiesRef, storyData);
                    storyCache.set(docRef.id, { id: docRef.id, ...storyData });
                    alert("Story up, bro!");
                    closeModal("addStoryModal");
                    renderStories([...storyCache.values()]);
                } catch (error) {
                    console.error("Error uploading story:", error);
                    alert("Upload failed, bro!");
                } finally {
                    isProcessing = false;
                }
            };

            cancelBtn.onclick = () => closeModal("addStoryModal");
        } catch (error) {
            console.error("Error in add story form:", error);
            alert("Shit broke, try again, bro!");
            closeModal("addStoryModal");
        } finally {
            isProcessing = false;
        }
    });
}

async function editStory(storyId, photoIndex) {
    if (isProcessing) return;
    isProcessing = true;
    try {
        const story = storyCache.get(storyId);
        if (!story) return alert("Story gone, bro!");

        const modal = document.getElementById("addStoryModal");
        modal.querySelector("h2").textContent = `Edit Story Photo #${photoIndex + 1}`;
        modal.style.display = "flex";
        modal.classList.remove("hidden");

        const fileInput = document.getElementById("storyImageInput");
        const textInput = document.getElementById("storyTextInput");
        const tagPostSelect = document.getElementById("tagPostSelect");
        const uploadBtn = document.getElementById("uploadStoryBtn");
        const cancelBtn = document.getElementById("cancelStoryBtn");

        fileInput.value = "";
        textInput.value = story.text || "";
        tagPostSelect.innerHTML = '<option value="">Select a post (optional)</option>';
        const postsSnapshot = await getDocs(query(collection(db, "communities", communityId, "posts"), where("userId", "==", userId)));
        postsSnapshot.forEach(doc => {
            const option = document.createElement("option");
            option.value = doc.id;
            option.textContent = doc.data().title;
            tagPostSelect.appendChild(option);
        });
        tagPostSelect.value = story.images[photoIndex].postId || "";
        uploadBtn.textContent = "Save Changes";

        uploadBtn.onclick = async () => {
            if (isProcessing) return;
            isProcessing = true;
            try {
                let updatedImages = [...story.images];
                if (fileInput.files[0]) {
                    const compressedBlob = await compressImage(fileInput.files[0]);
                    const storageRef = ref(storage, `stories/${communityId}/${userId}/${Date.now()}.jpg`);
                    await uploadBytes(storageRef, compressedBlob);
                    const newImageUrl = await getDownloadURL(storageRef);
                    if (updatedImages[photoIndex].imageUrl) await deleteObject(ref(storage, updatedImages[photoIndex].imageUrl));
                    updatedImages[photoIndex] = {
                        ...updatedImages[photoIndex],
                        imageUrl: newImageUrl,
                        timestamp: Timestamp.now()
                    };
                } else {
                    updatedImages[photoIndex] = {
                        ...updatedImages[photoIndex],
                        postId: tagPostSelect.value || null
                    };
                }

                const updatedStory = {
                    ...story,
                    images: updatedImages,
                    text: textInput.value.trim() || "",
                    timestamp: updatedImages.reduce((max, img) => 
                        img.timestamp.toMillis() > max.toMillis() ? img.timestamp : max, 
                        Timestamp.fromMillis(0)
                    )
                };

                await updateDoc(doc(db, "communities", communityId, "stories", storyId), updatedStory);
                storyCache.set(storyId, updatedStory);
                alert("Story fixed, bro!");
                closeModal("addStoryModal");
                renderStories([...storyCache.values()]);
            } catch (error) {
                console.error("Error editing story:", error);
                alert("Edit failed, bro!");
            } finally {
                isProcessing = false;
            }
        };

        cancelBtn.onclick = () => closeModal("addStoryModal");
    } catch (error) {
        console.error("Error setting up edit form:", error);
        alert("Edit setup fucked up, bro!");
        closeModal("addStoryModal");
    } finally {
        isProcessing = false;
    }
}

async function deleteStory(storyId, photoIndex) {
    if (isProcessing) return;
    if (!confirm("Delete this photo, bro?")) return;
    isProcessing = true;
    try {
        const story = storyCache.get(storyId);
        if (!story || !story.images[photoIndex]) return;

        const updatedImages = [...story.images];
        const [deletedImage] = updatedImages.splice(photoIndex, 1);
        if (deletedImage.imageUrl) await deleteObject(ref(storage, deletedImage.imageUrl));

        if (updatedImages.length === 0) {
            await deleteDoc(doc(db, "communities", communityId, "stories", storyId));
            storyCache.delete(storyId);
        } else {
            const updatedStory = {
                ...story,
                images: updatedImages,
                timestamp: updatedImages.reduce((max, img) => 
                    img.timestamp.toMillis() > max.toMillis() ? img.timestamp : max, 
                    Timestamp.fromMillis(0)
                )
            };
            await updateDoc(doc(db, "communities", communityId, "stories", storyId), updatedStory);
            storyCache.set(storyId, updatedStory);
        }

        alert("Photo trashed, bro!");
        const modalPhotos = document.getElementById("storyPhotosWrapper");
        if (modalPhotos) {
            modalPhotos.innerHTML = "";
            const now = Date.now();
            let totalPhotos = 0;
            let firstValidSlide = true;
            updatedImages.forEach((img, index) => {
                const isExpired = img.timestamp.toMillis() <= now - 24 * 60 * 60 * 1000;
                if (story.userId !== userId && isExpired) return;
                totalPhotos++;
                const slide = document.createElement("div");
                slide.className = "swiper-slide";
                let slideContent = `
                    <img src="${img.imageUrl}" alt="Story Photo" data-story-id="${storyId}" data-photo-index="${index}">
                    <div class="story-details">
                        <p>${story.text || ""}</p>
                `;
                if (isExpired && story.userId === userId) {
                    slideContent += `<div class="expired-warning">Photo expired (24h+)</div>`;
                } else if (totalPhotos > 1 && firstValidSlide && !isExpired) {
                    slideContent += `<div class="slide-hint">Slide to see more</div>`;
                    firstValidSlide = false;
                }
                slideContent += `</div>`;
                slide.innerHTML = slideContent;
                modalPhotos.appendChild(slide);
            });

            if (window.innerSwiper) window.innerSwiper.destroy(true, true);
            if (totalPhotos > 0) {
                window.innerSwiper = new Swiper('.swiper-container-inner', {
                    slidesPerView: 1,
                    navigation: { nextEl: '.swiper-button-next-inner', prevEl: '.swiper-button-prev-inner' },
                    loop: totalPhotos > 1 && story.userId !== userId,
                    on: {
                        init: () => setTimeout(() => updateSlideDetails(), 100),
                        slideChangeTransitionEnd: debounce(() => updateSlideDetails(), 50)
                    }
                });
            } else {
                closeModal("storyModal");
            }
        }
        renderStories([...storyCache.values()]);
    } catch (error) {
        console.error("Error deleting story photo:", error);
        alert("Delete failed, bro!");
    } finally {
        isProcessing = false;
    }

    function updateSlideDetails() {
        const activeSlide = document.getElementById("storyPhotosWrapper")?.querySelector(".swiper-slide-active");
        if (!activeSlide) return;
        const photoIndex = parseInt(activeSlide.querySelector("img").dataset.photoIndex);
        const imgData = updatedImages[photoIndex];
        document.getElementById("storyTimestamp").textContent = new Date(imgData.timestamp.toMillis()).toLocaleString();
        document.getElementById("storyText").textContent = story.text || "";
        const viewPostBtn = document.getElementById("viewPostBtn");
        viewPostBtn.classList.toggle("hidden", !imgData.postId || imgData.timestamp.toMillis() <= now - 24 * 60 * 60 * 1000);
        if (imgData.postId && imgData.timestamp.toMillis() > now - 24 * 60 * 60 * 1000) {
            viewPostBtn.onclick = () => {
                window.communitySearchPostsById(imgData.postId);
                document.getElementById("search-scrolldown2")?.scrollIntoView({ behavior: "smooth" });
                closeModal("storyModal");
            };
        } else {
            viewPostBtn.onclick = null;
        }
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
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
        const userDoc = await getDoc(doc(db, "users", uid));
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
            const maxWidth = 800, maxHeight = 800;
            let width = img.width, height = img.height;
            if (width > height) {
                if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
            } else {
                if (height > maxHeight) { width *= maxHeight / height; height = maxHeight; }
            }
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0, width, height);
            canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.7);
        };
        img.onerror = () => reject(new Error("Image compression failed"));
        img.src = URL.createObjectURL(file);
    });
}

function viewProfile(userId) {
    window.communityViewProfile(userId);
}

function throttle(func, wait) {
    let lastCall = 0;
    return function (...args) {
        const now = Date.now();
        if (now - lastCall >= wait) {
            lastCall = now;
            return func(...args);
        }
    };
}