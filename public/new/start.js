import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where, addDoc, limit, writeBatch } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// Global caches with expiration (5 minutes)
const firestoreCache = new Map();
const apiCache = new Map();
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

window.goToCommunity = function(communityId) {
  window.location.href = `./community.html?id=${communityId}`;
};

document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert("Log in to start swapping, bro!");
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
        userDoc = await getDoc(userRef); // Refresh after set
      }

      const userData = userDoc.data();
      setupCommunityPicker(userData);
    } catch (error) {
      console.error("Auth setup failed:", error);
      alert("Something broke, bro! Check console.");
    }
  });
});

function setupCommunityPicker(userData) {
  try {
    loadYourCommunities(userData);
    loadCommunities();

    const createBtn = document.getElementById("createCommunityBtn");
    const cancelBtn = document.getElementById("cancelCreateBtn");
    const exploreBtn = document.getElementById("exploreCommunitiesBtn");

    if (createBtn) createBtn.onclick = () => document.getElementById("createCommunityModal")?.classList.remove("hidden");
    if (cancelBtn) cancelBtn.onclick = () => document.getElementById("createCommunityModal")?.classList.add("hidden");
    if (exploreBtn) exploreBtn.onclick = showMapModal;

    setupLocationAutocomplete();
  } catch (error) {
    console.error("Setup crashed:", error);
    alert("Picker setup failed, bro!");
  }
}

async function loadYourCommunities() {
  const yourCommunityList = document.getElementById("yourCommunityList");
  if (!yourCommunityList) {
    console.error("yourCommunityList not found!");
    return;
  }
  yourCommunityList.innerHTML = "Loading your communities...";

  try {
    const userRef = doc(db, "users", auth.currentUser.uid);
    const userDoc = await getDoc(userRef);
    const communityIds = userDoc.data().communityIds || [];
    console.log("Raw communityIds:", communityIds);

    if (communityIds.length === 0) {
      yourCommunityList.innerHTML = "<p>You’re not in any communities yet.</p>";
      return;
    }

    // Filter by actual membership
    const validCommunities = [];
    for (const commId of communityIds) {
      const memberRef = doc(db, "communities", commId, "members", auth.currentUser.uid);
      const memberDoc = await getDoc(memberRef);
      if (memberDoc.exists()) {
        const commRef = doc(db, "communities", commId);
        const commDoc = await getDoc(commRef);
        if (commDoc.exists()) {
          validCommunities.push({ id: commId, ...commDoc.data() });
        }
      } else {
        console.log(`User not in members of ${commId}, skipping`);
      }
    }

    if (validCommunities.length === 0) {
      yourCommunityList.innerHTML = "<p>You’re not in any communities yet.</p>";
      return;
    }

    const cacheKey = `yourCommunities_${validCommunities.map(c => c.id).join(",")}`;
    const cached = firestoreCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
      renderYourCommunities(cached.data);
      return;
    }

    firestoreCache.set(cacheKey, { data: validCommunities, timestamp: Date.now() });
    renderYourCommunities(validCommunities);
  } catch (error) {
    console.error("Loading your communities failed:", error);
    yourCommunityList.innerHTML = "<p>Failed to load communities, bro!</p>";
  }

  function renderYourCommunities(communities) {
    yourCommunityList.innerHTML = "";
    communities.forEach(comm => {
      const div = document.createElement("div");
      div.innerHTML = `
        <span>${comm.name} ${comm.creatorId === auth.currentUser.uid ? "(Creator)" : ""}</span>
        <button class="go-btn" data-community-id="${comm.id}">Go</button>
      `;
      yourCommunityList.appendChild(div);
    });
    yourCommunityList.addEventListener("click", (e) => {
      const btn = e.target.closest(".go-btn");
      if (btn) goToCommunity(btn.dataset.communityId);
    }, { once: true });
  }
}

async function loadCommunities(searchQuery = "") {
  const communityList = document.getElementById("communityList");
  if (!communityList) {
    console.error("communityList not found!");
    return;
  }
  communityList.innerHTML = "Loading communities...";

  try {
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      const cacheKey = `search_${lowerQuery}`;
      const cached = firestoreCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
        renderCommunities(cached.data);
        return;
      }

      let q;
      if (searchQuery.length === 20) {
        q = query(collection(db, "communities"), where("__name__", "==", searchQuery), limit(10));
      } else {
        q = query(collection(db, "communities"), where("nameLower", ">=", lowerQuery), where("nameLower", "<=", lowerQuery + "\uf8ff"), limit(10));
      }
      const snapshot = await getDocs(q);
      const communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      firestoreCache.set(cacheKey, { data: communities, timestamp: Date.now() });
      renderCommunities(communities);
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          const cacheKey = `nearby_${latitude.toFixed(2)}_${longitude.toFixed(2)}`;
          const cached = firestoreCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
            renderCommunities(cached.data);
            return;
          }

          const q = query(collection(db, "communities"), limit(50));
          const snapshot = await getDocs(q);
          const communities = [];
          snapshot.forEach((doc) => {
            const comm = doc.data();
            const distance = calculateDistanceInMiles(latitude, longitude, comm.location.latitude, comm.location.longitude);
            if (distance <= 50) {
              communities.push({ id: doc.id, ...comm, distance });
            }
          });

          communities.sort((a, b) => a.distance - b.distance);
          firestoreCache.set(cacheKey, { data: communities, timestamp: Date.now() });
          renderCommunities(communities);
        },
        async () => {
          const cacheKey = "fallback";
          const cached = firestoreCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
            renderCommunities(cached.data);
            return;
          }

          const q = query(collection(db, "communities"), limit(50));
          const snapshot = await getDocs(q);
          const communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          firestoreCache.set(cacheKey, { data: communities, timestamp: Date.now() });
          renderCommunities(communities);
        }
      );
    } else {
      const cacheKey = "fallback";
      const cached = firestoreCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
        renderCommunities(cached.data);
        return;
      }

      const q = query(collection(db, "communities"), limit(50));
      const snapshot = await getDocs(q);
      const communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      firestoreCache.set(cacheKey, { data: communities, timestamp: Date.now() });
      renderCommunities(communities);
    }

    const searchInput = document.getElementById("communitySearch");
    if (searchInput) searchInput.oninput = debounce((e) => loadCommunities(e.target.value), 500); // Increased debounce

    function renderCommunities(communities) {
      communityList.innerHTML = communities.length === 0 
        ? "<p>No nearby communities found.</p><button id='retryGeoBtn'>Try Location Again</button>" 
        : "";
      communities.slice(0, 10).forEach((comm) => {
        const distanceText = comm.distance !== undefined ? ` (${comm.distance.toFixed(1)} miles away)` : "";
        const div = document.createElement("div");
        div.innerHTML = `
          <span>${comm.name}${distanceText}</span>
          <button class="join-btn" data-community-id="${comm.id}">Join</button>
        `;
        communityList.appendChild(div);
      });
    
      // Attach listeners
      communityList.querySelectorAll(".join-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          console.log(`Join button clicked for ${btn.dataset.communityId}`);
          joinCommunity(btn.dataset.communityId);
        });
      });
    
      const retryBtn = document.getElementById("retryGeoBtn");
      if (retryBtn) retryBtn.onclick = () => loadCommunities();
    }
  } catch (error) {
    console.error("Loading communities failed:", error);
    communityList.innerHTML = "<p>Failed to load communities, bro!</p>";
  }
}

window.joinCommunity = async function(communityId) {
  const user = auth.currentUser;
  if (!user) {
    alert("Bro, log in first!");
    return;
  }

  console.log(`Starting joinCommunity for ${communityId}, user ${user.uid}`);

  try {
    const userRef = doc(db, "users", user.uid);
    const commRef = doc(db, "communities", communityId);
    const memberRef = doc(db, "communities", communityId, "members", user.uid);

    console.log("Refs:", { userRef: userRef.path, commRef: commRef.path, memberRef: memberRef.path });

    const [commDoc, userDoc] = await Promise.all([getDoc(commRef), getDoc(userRef)]);
    if (!commDoc.exists()) {
      console.error(`Community ${communityId} doesn’t exist`);
      alert("This community ain’t real, bro!");
      return;
    }
    if (!userDoc.exists()) {
      console.error("User doc missing!");
      return;
    }

    console.log("Community data:", commDoc.data());
    const communityIds = userDoc.data().communityIds || [];
    console.log("Current communityIds:", communityIds);

    const batch = writeBatch(db);

    // Always update communityIds if not present
    if (!communityIds.includes(communityId)) {
      communityIds.push(communityId);
      batch.update(userRef, { communityIds });
      console.log(`Added ${communityId} to communityIds`);
    } else {
      console.log(`Already in communityIds: ${communityId}`);
    }

    // Always set member subcollection (like old code)
    batch.set(memberRef, { joinedAt: new Date(), userId: user.uid }, { merge: true });
    console.log("Setting member at:", memberRef.path);

    await batch.commit();
    console.log("Batch committed successfully!");

    // Verify
    const memberDoc = await getDoc(memberRef);
    if (memberDoc.exists()) {
      console.log("User added to members:", memberDoc.data());
    } else {
      console.error("User NOT added to members subcollection!");
      alert("Joined, but membership didn’t stick, bro!");
    }

    goToCommunity(communityId);
  } catch (error) {
    console.error("Join failed:", error.message, error.code);
    alert("Join crashed, bro! Check console.");
  }
};

function setupLocationAutocomplete() {
  const locationInput = document.getElementById("newCommunityLocation");
  const suggestionsDiv = document.getElementById("locationSuggestions");

  if (!locationInput || !suggestionsDiv) {
    console.error("Location autocomplete elements missing!");
    return;
  }

  const debouncedSearch = debounce(async (query) => {
    if (query.length < 2) {
      suggestionsDiv.innerHTML = "";
      return;
    }

    const cachedResult = apiCache.get(query);
    if (cachedResult && Date.now() - cachedResult.timestamp < CACHE_EXPIRY_MS) {
      renderSuggestions(cachedResult.data);
      return;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
      const response = await fetch(url, {
        headers: { "User-Agent": "LifeSwap/1.0 (your-email@example.com)" },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await response.json();

      apiCache.set(query, { data, timestamp: Date.now() });
      if (apiCache.size > 100) { // Cap cache size
        const oldestKey = [...apiCache.keys()][0];
        apiCache.delete(oldestKey);
      }

      renderSuggestions(data);
    } catch (error) {
      if (error.name === "AbortError") {
        console.warn("Location search timed out:", query);
        suggestionsDiv.innerHTML = "<p>Location search timed out, bro! Try again.</p>";
      } else {
        console.error("Autocomplete failed:", error);
        suggestionsDiv.innerHTML = "<p>Location search failed, bro!</p>";
      }
    }
  }, 500); // Increased debounce for API

  locationInput.oninput = (e) => debouncedSearch(e.target.value.trim());

  function renderSuggestions(data) {
    suggestionsDiv.innerHTML = "";
    if (!Array.isArray(data) || data.length === 0) {
      suggestionsDiv.innerHTML = "<p>No locations found, bro!</p>";
      return;
    }

    data.forEach((place) => {
      const city = place.address?.city || place.address?.town || place.address?.village || place.address?.hamlet || "";
      const state = place.address?.state || "";
      const country = place.address?.country || "";
      const region = state || country;
      const displayName = city && region ? `${city}, ${region}` : place.display_name;

      const lat = parseFloat(place.lat);
      const lon = parseFloat(place.lon);

      if (isNaN(lat) || isNaN(lon)) {
        console.error("Invalid lat/lon from Nominatim:", place);
        return;
      }

      const suggestion = document.createElement("div");
      suggestion.classList.add("suggestion-item");
      suggestion.textContent = displayName;
      suggestion.onclick = () => {
        locationInput.value = displayName;
        locationInput.dataset.lat = lat;
        locationInput.dataset.lon = lon;
        suggestionsDiv.innerHTML = "";
      };
      suggestionsDiv.appendChild(suggestion);
    });
  }

  const submitBtn = document.getElementById("submitCommunityBtn");
  if (submitBtn) {
    submitBtn.onclick = async () => {
      const nameInput = document.getElementById("newCommunityName");
      const name = nameInput?.value.trim();
      const location = locationInput.value.trim();
      const lat = parseFloat(locationInput.dataset.lat);
      const lon = parseFloat(locationInput.dataset.lon);

      if (!name || !location || isNaN(lat) || isNaN(lon)) {
        console.error("Invalid data:", { name, location, lat, lon });
        alert("Fill out the name and pick a valid location, bro!");
        return;
      }

      try {
        const user = auth.currentUser;
        if (!user) throw new Error("No user logged in!");

        const commRef = await addDoc(collection(db, "communities"), {
          name,
          nameLower: name.toLowerCase(),
          location: { latitude: lat, longitude: lon },
          creatorId: user.uid,
          createdAt: new Date()
        });

        const memberRef = doc(db, "communities", commRef.id, "members", user.uid);
        const userRef = doc(db, "users", user.uid);
        const userDoc = await getDoc(userRef);
        if (!userDoc.exists()) throw new Error("User doc missing!");

        const communityIds = userDoc.data().communityIds || [];
        const batch = writeBatch(db);
        batch.set(memberRef, { joinedAt: new Date() }, { merge: true });
        communityIds.push(commRef.id);
        batch.update(userRef, { communityIds });

        await batch.commit();
        document.getElementById("createCommunityModal")?.classList.add("hidden");
        goToCommunity(commRef.id);
      } catch (error) {
        console.error("Create community failed:", error);
        alert("Creation crashed, bro!");
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
    const loadHandler = () => loadCommunitiesInView(map, communityMarkers);
    map.on("moveend zoomend", loadHandler);
    centerMapOnUserLocation(map, communityMarkers);

    document.getElementById("closeMapBtn").onclick = () => {
      map.off("moveend zoomend", loadHandler);
      mapModal.classList.add("hidden");
      map.remove();
    };
  } catch (error) {
    console.error("Map modal failed:", error);
    mapModal.innerHTML = "<p>Map crashed, bro!</p>";
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

          accuracyCircle = L.circle([latitude, longitude], {
            color: "#135aac",
            fillColor: "#135aac",
            fillOpacity: 0.3,
            weight: 2,
            radius: accuracy
          }).addTo(map);

          userLocationMarker = L.marker([latitude, longitude])
            .bindPopup(`<b>Your location</b><br>Accuracy: ${Math.round(accuracy)} meters`)
            .addTo(map)
            .openPopup();

          const minZoomLevel = 16;
          const targetZoom = Math.min(Math.max(16 - Math.log2(accuracy / 50), minZoomLevel), 18);

          map.flyTo([latitude, longitude], targetZoom, { animate: true, duration: 1.5 });
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        (error) => {
          alert(`Can’t grab your spot, Bro: ${error.message}`);
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      alert("Your browser’s not down with geolocation, Bro.");
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
  const minZoomToShow = 6;

  markers.clearLayers();
  if (zoomLevel < minZoomToShow) return;

  try {
    const bounds = map.getBounds();
    const center = map.getCenter();
    const cacheKey = `map_${center.lat.toFixed(2)}_${center.lng.toFixed(2)}_${zoomLevel}`;
    const cached = firestoreCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_EXPIRY_MS) {
      cached.data.forEach(comm => markers.addLayer(comm.marker));
      return;
    }

    const q = query(collection(db, "communities"), limit(100));
    const snapshot = await getDocs(q);
    const communities = [];
    snapshot.forEach((doc) => {
      const comm = doc.data();
      const { latitude, longitude } = comm.location;

      if (bounds.contains([latitude, longitude])) {
        const shortName = comm.name.length > 10 ? `${comm.name.substring(0, 10)}...` : comm.name;
        const marker = L.marker([latitude, longitude]);
        marker.bindPopup(`
          <b>${comm.name}</b><br>
          <button class="map-join-btn" data-community-id="${doc.id}">Join</button>
        `);
        marker.bindTooltip(shortName, {
          permanent: true,
          direction: "top",
          offset: [-15, -5]
        });
        marker.on("popupopen", () => {
          const joinBtn = marker.getPopup().getElement().querySelector(".map-join-btn");
          if (joinBtn) {
            joinBtn.addEventListener("click", () => {
              joinCommunity(doc.id);
            });
          }
        });
        markers.addLayer(marker);
        communities.push({ ...comm, marker });
      }
    });

    firestoreCache.set(cacheKey, { data: communities, timestamp: Date.now() });
  } catch (error) {
    console.error("Loading map communities failed:", error);
  }
}