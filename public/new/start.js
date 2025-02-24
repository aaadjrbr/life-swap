import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, getDocs, query, where, addDoc, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

// Wait for DOM to load
document.addEventListener("DOMContentLoaded", () => {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      alert("Log in to start swapping, bro!");
      window.location.href = "/login.html";
    } else {
      const userRef = doc(db, "users", user.uid);
      const userDoc = await getDoc(userRef);

      if (!userDoc.exists()) {
        await setDoc(userRef, {
          name: user.displayName || "New Swapper",
          email: user.email || "",
          joinedAt: new Date(),
          communityIds: []
        });
      }

      const userData = userDoc.exists() ? userDoc.data() : (await getDoc(userRef)).data();
      showCommunityModal(userData);
    }
  });
});

// Show Community Modal
function showCommunityModal(userData) {
  const modal = document.getElementById("communityModal");
  if (!modal) {
    console.error("Community modal not found!");
    return;
  }
  modal.classList.remove("hidden");

  loadYourCommunities(userData);
  loadCommunities();

  document.getElementById("createCommunityBtn").onclick = () => {
    document.getElementById("createCommunityForm").classList.remove("hidden");
    document.getElementById("pickCommunity").classList.add("hidden");
  };

  document.getElementById("cancelCreateBtn").onclick = () => {
    document.getElementById("createCommunityForm").classList.add("hidden");
    document.getElementById("pickCommunity").classList.remove("hidden");
  };

  document.getElementById("exploreCommunitiesBtn").onclick = () => {
    showMapModal();
  };

  setupLocationAutocomplete();
}

// Load User's Communities
async function loadYourCommunities(userData) {
  const yourCommunityList = document.getElementById("yourCommunityList");
  if (!yourCommunityList) {
    console.error("yourCommunityList element not found!");
    return;
  }
  yourCommunityList.innerHTML = "Loading your communities...";

  const communityIds = userData.communityIds || [];
  if (communityIds.length === 0) {
    yourCommunityList.innerHTML = "<p>You’re not in any communities yet.</p>";
    return;
  }

  const q = query(collection(db, "communities"), where("__name__", "in", communityIds));
  const snapshot = await getDocs(q);
  yourCommunityList.innerHTML = "";

  snapshot.forEach((doc) => {
    const comm = doc.data();
    yourCommunityList.innerHTML += `
      <div>
        <span>${comm.name} ${comm.creatorId === auth.currentUser.uid ? "(Creator)" : ""}</span>
        <button onclick="goToCommunity('${doc.id}')">Go</button>
      </div>
    `;
  });
}

// Load Nearby Communities
async function loadCommunities(searchQuery = "") {
  const communityList = document.getElementById("communityList");
  if (!communityList) {
    console.error("communityList element not found!");
    return;
  }
  communityList.innerHTML = "Loading communities...";

  if (searchQuery) {
    // Case-insensitive search by converting to lowercase
    const lowerQuery = searchQuery.toLowerCase();
    let q;
    if (searchQuery.length === 20) { // Likely a community ID
      q = query(collection(db, "communities"), where("__name__", "==", searchQuery));
    } else {
      // Store lowercase name in Firestore for case-insensitive search
      q = query(collection(db, "communities"), where("nameLower", ">=", lowerQuery), where("nameLower", "<=", lowerQuery + "\uf8ff"), limit(10));
    }
    const snapshot = await getDocs(q);
    communityList.innerHTML = snapshot.empty ? "<p>No matching communities found.</p>" : "";
    snapshot.forEach((doc) => {
      const comm = doc.data();
      communityList.innerHTML += `
        <div>
          <span>${comm.name}</span>
          <button onclick="joinCommunity('${doc.id}')">Join</button>
        </div>
      `;
    });
  } else if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const q = query(collection(db, "communities"), limit(10));
        const snapshot = await getDocs(q);
        const communities = [];

        snapshot.forEach((doc) => {
          const comm = doc.data();
          const distance = calculateDistanceInMiles(
            latitude,
            longitude,
            comm.location.latitude,
            comm.location.longitude
          );
          if (distance <= 50) {
            communities.push({ id: doc.id, ...comm, distance });
          }
        });

        communities.sort((a, b) => a.distance - b.distance);
        communityList.innerHTML = communities.length === 0 ? "<p>No nearby communities found.</p>" : "";
        communities.forEach((comm) => {
          communityList.innerHTML += `
            <div>
              <span>${comm.name} (${comm.distance.toFixed(1)} miles away)</span>
              <button onclick="joinCommunity('${comm.id}')">Join</button>
            </div>
          `;
        });
      },
      () => {
        const q = query(collection(db, "communities"), limit(10));
        getDocs(q).then((snapshot) => {
          communityList.innerHTML = snapshot.empty ? "<p>No communities found.</p>" : "";
          snapshot.forEach((doc) => {
            const comm = doc.data();
            communityList.innerHTML += `
              <div>
                <span>${comm.name}</span>
                <button onclick="joinCommunity('${doc.id}')">Join</button>
              </div>
            `;
          });
        });
      }
    );
  } else {
    const q = query(collection(db, "communities"), limit(10));
    const snapshot = await getDocs(q);
    communityList.innerHTML = snapshot.empty ? "<p>No communities found.</p>" : "";
    snapshot.forEach((doc) => {
      const comm = doc.data();
      communityList.innerHTML += `
        <div>
          <span>${comm.name}</span>
          <button onclick="joinCommunity('${doc.id}')">Join</button>
        </div>
      `;
    });
  }

  document.getElementById("communitySearch").oninput = (e) => {
    loadCommunities(e.target.value);
  };
}

// Join a Community
window.joinCommunity = async function(communityId) {
  const user = auth.currentUser;
  const userRef = doc(db, "users", user.uid);
  const commRef = doc(db, "communities", communityId);

  const userDoc = await getDoc(userRef);
  const communityIds = userDoc.data().communityIds || [];
  if (!communityIds.includes(communityId)) {
    communityIds.push(communityId);
    await updateDoc(userRef, { communityIds });
  }

  const commDoc = await getDoc(commRef);
  const members = commDoc.data().members || [];
  if (!members.includes(user.uid)) {
    members.push(user.uid);
    await updateDoc(commRef, { members });
  }

  document.getElementById("communityModal").classList.add("hidden");
  goToCommunity(communityId);
};

// Go to Community Page
window.goToCommunity = function(communityId) {
  window.location.href = `./community.html?id=${communityId}`;
};

// Setup Location Autocomplete with Nominatim
function setupLocationAutocomplete() {
  const locationInput = document.getElementById("newCommunityLocation");
  const suggestionsDiv = document.getElementById("locationSuggestions");

  locationInput.oninput = debounce(async () => {
    const query = locationInput.value.trim();
    if (query.length < 2) {
      suggestionsDiv.innerHTML = "";
      return;
    }

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5&addressdetails=1`;
    const response = await fetch(url, {
      headers: { "User-Agent": "LifeSwap/1.0 (your-email@example.com)" }
    });
    const data = await response.json();

    suggestionsDiv.innerHTML = "";
    data.forEach((place) => {
      const city = place.address.city || place.address.town || place.address.village || place.address.hamlet || "";
      const state = place.address.state || "";
      const country = place.address.country || "";
      const region = state ? state : country;
      const displayName = city && region ? `${city}, ${region}` : place.display_name;

      const suggestion = document.createElement("div");
      suggestion.classList.add("suggestion-item");
      suggestion.textContent = displayName;
      suggestion.onclick = () => {
        locationInput.value = displayName;
        locationInput.dataset.lat = place.lat;
        locationInput.dataset.lon = place.lon;
        suggestionsDiv.innerHTML = "";
      };
      suggestionsDiv.appendChild(suggestion);
    });
  }, 300);

  document.getElementById("submitCommunityBtn").onclick = async () => {
    const name = document.getElementById("newCommunityName").value.trim();
    const location = document.getElementById("newCommunityLocation").value.trim();
    const lat = parseFloat(locationInput.dataset.lat);
    const lon = parseFloat(locationInput.dataset.lon);

    if (!name || !location || isNaN(lat) || isNaN(lon)) {
      alert("Fill out the name and pick a valid location, bro!");
      return;
    }

    const user = auth.currentUser;
    const commRef = await addDoc(collection(db, "communities"), {
      name,
      nameLower: name.toLowerCase(), // Store lowercase for case-insensitive search
      location: { latitude: lat, longitude: lon },
      members: [user.uid],
      creatorId: user.uid,
      createdAt: new Date()
    });

    const userRef = doc(db, "users", user.uid);
    const userDoc = await getDoc(userRef);
    const communityIds = userDoc.data().communityIds || [];
    communityIds.push(commRef.id);
    await updateDoc(userRef, { communityIds });

    document.getElementById("communityModal").classList.add("hidden");
    goToCommunity(commRef.id);
  };
}

// Distance Calculation
function calculateDistanceInMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (val) => val * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Debounce for Autocomplete
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// In showCommunityModal
document.getElementById("exploreCommunitiesBtn").onclick = () => {
  showMapModal();
};

// Show Map Modal
async function showMapModal() {
  const mapModal = document.getElementById("mapModal");
  mapModal.classList.remove("hidden");

  const map = L.map("map").setView([39.8283, -98.5795], 4);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  // Define communityMarkers here, before any calls
  const communityMarkers = L.layerGroup().addTo(map);

  // Hook up the event listener with markers
  map.on("moveend zoomend", () => loadCommunitiesInView(map, communityMarkers));

  // Pass communityMarkers to centerMapOnUserLocation
  centerMapOnUserLocation(map, communityMarkers);

  document.getElementById("closeMapBtn").onclick = () => {
    mapModal.classList.add("hidden");
    map.remove();
  };
}

// Center Map on User Location
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

      const geoOptions = {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      };

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

          const minZoomLevel = 16; // Was 16, but you might want 12 here
          const targetZoom = Math.min(
            Math.max(16 - Math.log2(accuracy / 50), minZoomLevel),
            18
          );

          map.flyTo([latitude, longitude], targetZoom, {
            animate: true,
            duration: 1.5
          });

          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        (error) => {
          alert(`Can’t grab your spot, Bro: ${error.message}`);
          recenterButton.textContent = "📍";
          recenterButton.disabled = false;
        },
        geoOptions
      );
    } else {
      alert("Your browser’s not down with geolocation, Bro.");
    }
  };

  // Initial load with geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const targetZoom = Math.min(
          Math.max(16 - Math.log2(accuracy / 50), 12),
          18
        );
        map.setView([latitude, longitude], targetZoom);
        loadCommunitiesInView(map, communityMarkers); // Pass markers here
      },
      () => {
        loadCommunitiesInView(map, communityMarkers); // Pass markers on fallback
      }
    );
  } else {
    loadCommunitiesInView(map, communityMarkers); // Pass markers if no geolocation
  }

  document.getElementById("map").appendChild(recenterButton);
}

// Load Communities in Map View
async function loadCommunitiesInView(map, markers) {
  const zoomLevel = map.getZoom();
  const minZoomToShow = 6; // You set this to 6, cool for broader view

  markers.clearLayers(); // This is line 458-ish, now safe ‘cause markers is always defined

  if (zoomLevel < minZoomToShow) {
    return;
  }

  const bounds = map.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();

  const q = query(
    collection(db, "communities"),
    where("location.latitude", ">=", sw.lat),
    where("location.latitude", "<=", ne.lat)
  );

  const snapshot = await getDocs(q);
  snapshot.forEach((doc) => {
    const comm = doc.data();
    const { latitude, longitude } = comm.location;

    if (longitude < sw.lng || longitude > ne.lng) return;

    const shortName = comm.name.length > 10 ? `${comm.name.substring(0, 10)}...` : comm.name;

    const marker = L.marker([latitude, longitude]);
    marker.bindPopup(`
      <b>${comm.name}</b><br>
      <button onclick="joinCommunity('${doc.id}')">Join</button>
    `);
    marker.bindTooltip(shortName, {
      permanent: true,
      direction: "top",
      offset: [-15, -5]
    });
    markers.addLayer(marker);
  });
}