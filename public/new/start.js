import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where, addDoc, limit, writeBatch, orderBy, startAfter } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Firebase Config
const firebaseConfig = {
  apiKey: "AIzaSyB5Q0kHoViWJl-t-pWCKj_AT-ClAMadfrU",
  authDomain: "life-swap-6065e.firebaseapp.com",
  projectId: "life-swap-6065e",
  storageBucket: "life-swap-6065e.firebasestorage.app",
  messagingSenderId: "475311181000",
  appId: "1:475311181000:web:32d03d80f70081bfb629fd",
  measurementId: "G-CHJY2ZEYYF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// Simple session cache (no expiration, no cap)
const sessionCache = new Map();

window.goToCommunity = function(communityId) {
  window.location.href = `./community.html?id=${communityId}`;
};

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert("Log in to start swapping!");
      window.location.href = "/login.html";
      return;
    }
    try {
      const userRef = doc(db, "users", user.uid);
      let userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        await setDoc(userRef, {
          name: user.displayName || "New Swapper",
          email: user.email || "",
          joinedAt: new Date(),
          communityIds: []
        });
        userDoc = await getDoc(userRef);
      }

      // Check and clean communityIds on page load
      const userData = await checkAndCleanCommunityIds(user.uid, userDoc.data());
      setupCommunityPicker(userData);
    } catch (error) {
      console.error("Auth setup failed:", error);
      alert("Something broke! Check console.");
    }
  });
});

// Efficient checker for communityIds - ⚠️ IMPORTANT: This checks for communities ids that doesn't exist in cases ownwer delete communities wihtout user having a chance to leave, so the ID of the community might remains, so this function deletes it.
async function checkAndCleanCommunityIds(userId, userData) {
  const communityIds = userData.communityIds || [];
  if (communityIds.length === 0) return userData;

  // Batch check existence of community IDs
  const validIds = [];
  const promises = communityIds.map(async (commId) => {
    const commRef = doc(db, "communities", commId);
    const commDoc = await getDoc(commRef);
    if (commDoc.exists()) validIds.push(commId);
  });
  await Promise.all(promises);

  // If there are invalid IDs, update the user doc
  if (validIds.length !== communityIds.length) {
    const userRef = doc(db, "users", userId);
    await updateDoc(userRef, { communityIds: validIds });
    console.log(`Cleaned communityIds for user ${userId}:`, validIds);
    return { ...userData, communityIds: validIds };
  }
  return userData;
}

function setupCommunityPicker(userData) {
  loadYourCommunities(userData);
  loadCommunities();

  const createBtn = document.getElementById("createCommunityBtn");
  const cancelBtn = document.getElementById("cancelCreateBtn");
  const exploreBtn = document.getElementById("exploreCommunitiesBtn");

  if (createBtn) createBtn.onclick = () => document.getElementById("createCommunityModal")?.classList.remove("hidden");
  if (cancelBtn) cancelBtn.onclick = () => document.getElementById("createCommunityModal")?.classList.add("hidden");
  if (exploreBtn) exploreBtn.onclick = showMapModal;

  setupLocationAutocomplete();
}

async function loadYourCommunities(userData) {
  const yourCommunityList = document.getElementById("yourCommunityList");
  if (!yourCommunityList) return;

  yourCommunityList.innerHTML = "Loading your communities...";
  const userId = auth.currentUser.uid;
  const cacheKey = `yourCommunities_${userId}`;

  if (sessionCache.has(cacheKey)) {
    renderYourCommunities(sessionCache.get(cacheKey));
    return;
  }

  try {
    const communityIds = userData.communityIds || [];
    if (communityIds.length === 0) {
      yourCommunityList.innerHTML = "<p>You’re not in any communities yet.</p>";
      return;
    }

    const validCommunities = await Promise.all(
      communityIds.map(async (commId) => {
        const memberRef = doc(db, "communities", commId, "members", userId);
        const commRef = doc(db, "communities", commId);
        const [memberDoc, commDoc] = await Promise.all([getDoc(memberRef), getDoc(commRef)]);
        return memberDoc.exists() && commDoc.exists() ? { id: commId, ...commDoc.data() } : null;
      })
    ).then(results => results.filter(Boolean));

    if (validCommunities.length === 0) {
      yourCommunityList.innerHTML = "<p>You’re not in any communities yet.</p>";
      return;
    }

    sessionCache.set(cacheKey, validCommunities);
    renderYourCommunities(validCommunities);
  } catch (error) {
    console.error("Loading your communities failed:", error);
    yourCommunityList.innerHTML = "<p>Failed to load communities!</p>";
  }

  function renderYourCommunities(communities) {
    yourCommunityList.innerHTML = communities.map(comm => `
      <div>
        <span>${comm.name} ${comm.creatorId === userId ? "(Creator)" : ""}</span>
        <button class="go-btn" data-community-id="${comm.id}">Go</button>
        <button class="share-btn" data-community-id="${comm.id}">Share (QR Code)</button>
      </div>
    `).join("");
  
    // Throttle function to limit clicks
    function throttle(func, wait) {
      let lastCall = 0;
      return function (...args) {
        const now = Date.now();
        if (now - lastCall >= wait) {
          lastCall = now;
          return func.apply(this, args);
        }
      };
    }
  
    // Attach throttled listeners to each button
    document.querySelectorAll(".go-btn").forEach(btn => {
      btn.addEventListener("click", throttle(() => goToCommunity(btn.dataset.communityId), 2000)); // 2-second throttle
    });
    document.querySelectorAll(".share-btn").forEach(btn => {
      btn.addEventListener("click", throttle(() => generateShareContent(btn.dataset.communityId), 2000)); // 2-second throttle
    });
  }
}

async function generateShareContent(communityId) {
  try {
    if (!window.jspdf || !window.jspdf.jsPDF || !window.QRCode) {
      throw new Error("Required libraries (jsPDF or QRCode) are not loaded yet.");
    }

    const commRef = doc(db, "communities", communityId);
    const commDoc = await getDoc(commRef);
    if (!commDoc.exists()) {
      alert("Community not found.");
      return;
    }
    const commData = commDoc.data();

    const { latitude, longitude } = commData.location;
    const locationName = await getLocationName(latitude, longitude);
    const qrUrl = `${window.location.origin}/join.html?id=${communityId}`;

    // Generate QR code
    const qrCanvas = document.createElement("canvas");
    await QRCode.toCanvas(qrCanvas, qrUrl, { width: 150 });
    const qrImageData = qrCanvas.toDataURL("image/png");

    // Create modal
    const modal = document.createElement("div");
    modal.id = "shareModal";
    modal.className = "modal";
    modal.innerHTML = `
      <div class="modal-content">
        <h2>Share Option</h2>
        <p>Select how you'd like to share this community:</p>
        <button id="qrOption">Download QR Code</button>
        <button id="pdfOption">Download PDF</button>
        <button id="cancelOption">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);

    // Handle modal choices
    const qrButton = document.getElementById("qrOption");
    const pdfButton = document.getElementById("pdfOption");
    const cancelButton = document.getElementById("cancelOption");

    return new Promise((resolve) => {
      qrButton.onclick = () => {
        const link = document.createElement("a");
        link.href = qrImageData;
        link.download = `${commData.name}_qr.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        document.body.removeChild(modal);
        resolve();
      };

      pdfButton.onclick = () => {
        const { jsPDF } = window.jspdf;
        const pdfDoc = new jsPDF();

        pdfDoc.setFontSize(16);
        pdfDoc.text("Join Our Community!", 20, 20);
        pdfDoc.setFontSize(12);
        pdfDoc.text(`Community: ${commData.name}`, 20, 30);
        pdfDoc.text(`Location: ${locationName}`, 20, 40);
        pdfDoc.addImage(qrImageData, "PNG", 20, 50, 50, 50);
        pdfDoc.text("Scan to join Life Swap!", 20, 110);

        pdfDoc.setFontSize(10);
        pdfDoc.text(
          [
            "Life Swap is more than a platform—it’s a community-driven movement.",
            "Here, individuals exchange items they no longer need for things they do,",
            "fostering connections over transactions. It’s not about money; it’s about",
            "building meaningful relationships through sharing. In a society focused",
            "on possession, Life Swap encourages giving, growth, and collaboration,",
            "creating a network that thrives on mutual support, one swap at a time."
          ],
          20,
          130,
          { maxWidth: 170 }
        );

        pdfDoc.save(`${commData.name}_invite.pdf`);
        document.body.removeChild(modal);
        resolve();
      };

      cancelButton.onclick = () => {
        document.body.removeChild(modal);
        resolve();
      };
    });
  } catch (error) {
    console.error("Failed to generate share content:", error);
    alert("An error occurred while generating the share content. Please check the console for details.");
  }
}

// Reverse geocode lat/lon to a readable name
async function getLocationName(lat, lon) {
  const cacheKey = `loc_${lat}_${lon}`;
  if (sessionCache.has(cacheKey)) return sessionCache.get(cacheKey);

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`, {
      headers: { "User-Agent": "LifeSwap/1.0 (your-email@example.com)" },
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    const city = data.address?.city || data.address?.town || data.address?.village || "";
    const region = data.address?.state || data.address?.country || "";
    const locationName = city && region ? `${city}, ${region}` : data.display_name || "Unknown Location";
    sessionCache.set(cacheKey, locationName);
    return locationName;
  } catch (error) {
    console.error("Reverse geocoding failed:", error);
    return "Unknown Location";
  }
}

async function loadCommunities(searchQuery = "", startAfterDoc = null) {
  const communityList = document.getElementById("communityList");
  if (!communityList) return;

  communityList.innerHTML = "Loading communities...";
  const cacheKey = searchQuery ? `search_${searchQuery}` : "nearby";

  if (sessionCache.has(cacheKey) && !startAfterDoc) {
    renderCommunities(sessionCache.get(cacheKey));
    return;
  }

  try {
    let communities = [];
    let snapshot;

    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      let q;

      if (searchQuery.length === 20) {
        console.log("Searching by ID:", searchQuery); // Debug
        q = query(
          collection(db, "communities"),
          where("__name__", "==", searchQuery),
          limit(1) // Only expect one match for an ID
        );
      } else {
        console.log("Searching by name:", lowerQuery); // Debug
        q = query(
          collection(db, "communities"),
          where("nameLower", ">=", lowerQuery),
          where("nameLower", "<=", lowerQuery + "\uf8ff"),
          limit(10)
        );
      }

      if (startAfterDoc) {
        console.log("Applying startAfter with doc:", startAfterDoc.id);
        q = query(q, startAfter(startAfterDoc));
      }

      snapshot = await getDocs(q);
      communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("Found communities:", communities); // Debug
    } else if (navigator.geolocation) {
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject)
      );
      const { latitude, longitude } = position.coords;
      let q = query(collection(db, "communities"), limit(50));
      if (startAfterDoc) {
        console.log("Applying startAfter with doc:", startAfterDoc.id);
        q = query(q, startAfter(startAfterDoc));
      }
      snapshot = await getDocs(q);
      snapshot.forEach(doc => {
        const comm = doc.data();
        const distance = calculateDistanceInMiles(latitude, longitude, comm.location.latitude, comm.location.longitude);
        if (distance <= 50) communities.push({ id: doc.id, ...comm, distance });
      });
      communities.sort((a, b) => a.distance - b.distance);
    } else {
      let q = query(collection(db, "communities"), limit(50));
      if (startAfterDoc) {
        console.log("Applying startAfter with doc:", startAfterDoc.id);
        q = query(q, startAfter(startAfterDoc));
      }
      snapshot = await getDocs(q);
      communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }

    const allCommunities = sessionCache.get(cacheKey) || [];
    const updatedCommunities = startAfterDoc ? [...allCommunities, ...communities] : communities;
    sessionCache.set(cacheKey, updatedCommunities);
    renderCommunities(updatedCommunities, communities.length ? snapshot.docs[snapshot.docs.length - 1] : null);
  } catch (error) {
    console.error("Loading communities failed:", error);
    communityList.innerHTML = "<p>Failed to load communities!</p>";
  }

  function renderCommunities(communities, lastDoc) {
    communityList.innerHTML = communities.length === 0
      ? "<p>No nearby communities found.</p>"
      : communities.slice(0, 10).map(comm => {
          const distanceText = comm.distance !== undefined ? ` (${comm.distance.toFixed(1)} miles away)` : "";
          return `<div><span>${comm.name}${distanceText}</span><button class="join-btn" data-community-id="${comm.id}">Join</button></div>`;
        }).join("");

    if (communities.length > 10 && lastDoc) {
      const loadMoreBtn = document.createElement("button");
      loadMoreBtn.textContent = "Load More";
      loadMoreBtn.onclick = () => loadCommunities(searchQuery, lastDoc);
      communityList.appendChild(loadMoreBtn);
    }

    communityList.addEventListener("click", (e) => {
      const btn = e.target.closest(".join-btn");
      if (btn) joinCommunity(btn.dataset.communityId);
    }, { once: true });
  }

  const searchInput = document.getElementById("communitySearch");
  if (searchInput) searchInput.oninput = debounce((e) => loadCommunities(e.target.value), 500);
}

window.joinCommunity = async function(communityId) {
  const user = auth.currentUser;
  if (!user) {
    alert("Bro, log in first!");
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const commRef = doc(db, "communities", communityId);
    const memberRef = doc(db, "communities", communityId, "members", user.uid);

    const [commDoc, userDoc] = await Promise.all([getDoc(commRef), getDoc(userRef)]);
    if (!commDoc.exists()) {
      alert("This community is not real!");
      return;
    }
    if (!userDoc.exists()) return;

    const communityIds = userDoc.data().communityIds || [];
    const batch = writeBatch(db);

    if (!communityIds.includes(communityId)) {
      communityIds.push(communityId);
      batch.update(userRef, { communityIds });
    }

    batch.set(memberRef, { joinedAt: new Date(), userId: user.uid }, { merge: true });
    await batch.commit();

    const memberDoc = await getDoc(memberRef);
    if (!memberDoc.exists()) {
      alert("Joined, but membership didn’t stick!");
    } else {
      sessionCache.delete(`yourCommunities_${user.uid}`); // Invalidate cache
      goToCommunity(communityId);
    }
  } catch (error) {
    console.error("Join failed:", error);
    alert("Join crashed!");
  }
};

function setupLocationAutocomplete() {
  const locationInput = document.getElementById("newCommunityLocation");
  const suggestionsDiv = document.getElementById("locationSuggestions");
  if (!locationInput || !suggestionsDiv) return;

  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      suggestionsDiv.innerHTML = "";
      return;
    }

    if (sessionCache.has(query)) {
      renderSuggestions(sessionCache.get(query));
      return;
    }

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`, {
        headers: { "User-Agent": "LifeSwap/1.0 (your-email@example.com)" },
        signal: AbortSignal.timeout(5000)
      });
      const data = await response.json();
      sessionCache.set(query, data);
      renderSuggestions(data);
    } catch (error) {
      console.error("Autocomplete failed:", error);
      suggestionsDiv.innerHTML = "<p>Location search failed!</p>";
    }
  }, 500);

  locationInput.oninput = (e) => debouncedSearch(e.target.value.trim());

  function renderSuggestions(data) {
    suggestionsDiv.innerHTML = !Array.isArray(data) || data.length === 0
      ? "<p>No locations found!</p>"
      : data.map(place => {
          const city = place.address?.city || place.address?.town || place.address?.village || "";
          const region = place.address?.state || place.address?.country || "";
          const displayName = city && region ? `${city}, ${region}` : place.display_name;
          const lat = parseFloat(place.lat);
          const lon = parseFloat(place.lon);
          if (isNaN(lat) || isNaN(lon)) return "";
          return `<div class="suggestion-item" data-lat="${lat}" data-lon="${lon}">${displayName}</div>`;
        }).join("");

    suggestionsDiv.querySelectorAll(".suggestion-item").forEach(item => {
      item.onclick = () => {
        locationInput.value = item.textContent;
        locationInput.dataset.lat = item.dataset.lat;
        locationInput.dataset.lon = item.dataset.lon;
        suggestionsDiv.innerHTML = "";
      };
    });
  }

  const submitBtn = document.getElementById("submitCommunityBtn");
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const name = document.getElementById("newCommunityName")?.value.trim();
      const location = locationInput.value.trim();
      const lat = parseFloat(locationInput.dataset.lat);
      const lon = parseFloat(locationInput.dataset.lon);

      if (!name || !location || isNaN(lat) || isNaN(lon)) {
        alert("Fill out the name and pick a valid location!");
        return;
      }

      try {
        const user = auth.currentUser;
        if (!user) throw new Error("No user logged in!");

        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error("User doc missing!");

        const commRef = await addDoc(collection(db, "communities"), {
          name,
          nameLower: name.toLowerCase(),
          location: { latitude: lat, longitude: lon },
          creatorId: user.uid,
          createdAt: new Date()
        });

        const batch = writeBatch(db);
        batch.set(doc(db, "communities", commRef.id, "members", user.uid), { joinedAt: new Date() });
        const currentCommunityIds = userDoc.data().communityIds || []; // Fetch fresh from Firestore
        batch.update(userRef, { communityIds: [...currentCommunityIds, commRef.id] });
        await batch.commit();

        sessionCache.delete(`yourCommunities_${user.uid}`);
        document.getElementById("createCommunityModal")?.classList.add("hidden");
        goToCommunity(commRef.id);
      } catch (error) {
        console.error("Create community failed:", error);
        alert("Creation crashed!");
      }
    };
  }
}

function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (val) => val * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

async function showMapModal() {
  const mapModal = document.getElementById("mapModal");
  if (!mapModal) return;
  mapModal.classList.remove("hidden");

  try {
    const map = L.map("map").setView([39.8283, -98.5795], 4);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    const communityMarkers = L.layerGroup().addTo(map);
    const loadHandler = debounce(() => loadCommunitiesInView(map, communityMarkers), 500);
    map.on("moveend zoomend", loadHandler);
    centerMapOnUserLocation(map, communityMarkers);

    document.getElementById("closeMapBtn").onclick = () => {
      map.off("moveend zoomend", loadHandler);
      mapModal.classList.add("hidden");
      map.remove();
    };
  } catch (error) {
    console.error("Map modal failed:", error);
    mapModal.innerHTML = "<p>Map crashed!</p>";
  }
}

function centerMapOnUserLocation(map, communityMarkers) {
  const recenterButton = document.createElement("button");
  recenterButton.textContent = "📍";
  recenterButton.style.cssText = `
    position: absolute;
    top: 70px;
    left: 4px;
    z-index: 1000;
    padding: 10px;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 5px;
    cursor: pointer;
    font-size: 16px;
  `;

  let userLocationMarker = null;
  let accuracyCircle = null;

  recenterButton.onclick = () => {
    if (navigator.geolocation) {
      recenterButton.textContent = "⌛";
      recenterButton.disabled = true;
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          if (userLocationMarker) map.removeLayer(userLocationMarker);
          if (accuracyCircle) map.removeLayer(accuracyCircle);

          accuracyCircle = L.circle([latitude, longitude], { radius: accuracy, color: "#135aac", fillOpacity: 0.3 }).addTo(map);
          userLocationMarker = L.marker([latitude, longitude]).bindPopup(`Your location<br>Accuracy: ${Math.round(accuracy)}m`).addTo(map).openPopup();

          const targetZoom = Math.min(Math.max(16 - Math.log2(accuracy / 50), 16), 18);
          map.flyTo([latitude, longitude], targetZoom, { duration: 1.5 });
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        (error) => {
          alert(`Can’t grab your spot, bro: ${error.message}`);
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      alert("No geolocation support!");
    }
  };

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const targetZoom = Math.min(Math.max(16 - Math.log2(accuracy / 50), 12), 18);
        map.setView([latitude, longitude], targetZoom);
        loadCommunitiesInView(map, communityMarkers);
      },
      () => loadCommunitiesInView(map, communityMarkers)
    );
  } else {
    loadCommunitiesInView(map, communityMarkers);
  }

  document.getElementById("map").appendChild(recenterButton);
}

async function loadCommunitiesInView(map, markers) {
  const zoomLevel = map.getZoom();
  if (zoomLevel < 6) return;

  markers.clearLayers();
  const bounds = map.getBounds();
  const cacheKey = `map_${bounds.getCenter().lat.toFixed(2)}_${bounds.getCenter().lng.toFixed(2)}_${zoomLevel}`;

  if (sessionCache.has(cacheKey)) {
    sessionCache.get(cacheKey).forEach(comm => markers.addLayer(comm.marker));
    return;
  }

  try {
    const q = query(collection(db, "communities"), limit(100));
    const snapshot = await getDocs(q);
    const communities = [];
    snapshot.forEach(doc => {
      const comm = doc.data();
      const { latitude, longitude } = comm.location;
      if (bounds.contains([latitude, longitude])) {
        const shortName = comm.name.length > 10 ? `${comm.name.substring(0, 10)}...` : comm.name;
        const marker = L.marker([latitude, longitude])
          .bindPopup(`<b>${comm.name}</b><br><button class="map-join-btn" data-community-id="${doc.id}">Join</button>`)
          .bindTooltip(shortName, { permanent: true, direction: "top", offset: [-15, -5] });
        marker.on("popupopen", () => {
          marker.getPopup().getElement().querySelector(".map-join-btn")?.addEventListener("click", () => joinCommunity(doc.id));
        });
        communities.push({ ...comm, marker });
      }
    });

    sessionCache.set(cacheKey, communities);
    communities.forEach(comm => markers.addLayer(comm.marker));
  } catch (error) {
    console.error("Loading map communities failed:", error);
  }
}