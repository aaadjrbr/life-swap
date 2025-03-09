import { getAuth, getFirestore, doc, getDoc, updateDoc } from './firebaseConfig.js';

// Load Google Fonts
const googleFonts = [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", 
    "Oswald", "Raleway", "Merriweather", "Playfair Display", "Nunito",
    "Bebas Neue", "Lobster", "Pacifico", "Abril Fatface", "Dancing Script"
];
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css?family=" + googleFonts.join("|").replace(/ /g, "+");
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// Parse links and emails
function parseLinksAndEmails(text) {
    const urlPattern = /(\bhttps?:\/\/[^\s<]+[^\s<.,!?;:])/gi;
    text = text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    const emailPattern = /(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/gi;
    return text.replace(emailPattern, '<a href="mailto:$1">$1</a>');
}

// Create and style the custom header
function createCustomHeader() {
    if (document.getElementById("custom-header")) return;

    const communityId = new URLSearchParams(window.location.search).get("id");
    if (!communityId) return;

    let config = {
        message: "Welcome!\nFollow the rules\nOr get banned!",
        font: "Roboto",
        bgColor: "#ffcccc",
        textColor: "#333",
        fontSize: "17px"
    };

    fetchCustomSettings(communityId).then(customConfig => {
        if (customConfig) config = { ...config, ...customConfig };

        const header = document.createElement("div");
        header.id = "custom-header";
        header.style.backgroundColor = config.bgColor;
        
        const textContainer = document.createElement("div");
        textContainer.className = "header-text";
        textContainer.contentEditable = false;
        textContainer.innerHTML = parseLinksAndEmails(config.message).replace(/\n/g, "<br>");
        
        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = "See more";
        toggleBtn.className = "toggle-btn";
        toggleBtn.style.display = "none";

        toggleBtn.onclick = () => {
            const scrollY = window.scrollY;
            if (textContainer.classList.contains("collapsed")) {
                textContainer.classList.remove("collapsed");
                textContainer.style.maxHeight = `${textContainer.scrollHeight}px`;
                toggleBtn.textContent = "Hide";
            } else {
                textContainer.classList.add("collapsed");
                textContainer.style.maxHeight = "50px";
                toggleBtn.textContent = "See more";
            }
            window.scrollTo(0, scrollY);
        };

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit Header";
        editBtn.className = "edit-header-btn";

        header.appendChild(textContainer);
        header.appendChild(toggleBtn);
        header.appendChild(editBtn);
        applyTextStyles(textContainer, config);

        requestAnimationFrame(() => {
            if (textContainer.scrollHeight > 50) {
                textContainer.classList.add("collapsed");
                textContainer.style.maxHeight = "50px";
                toggleBtn.style.display = "block";
            }
        });

        const communityPage = document.querySelector(".community-page");
        const topBar = document.querySelector(".top-bar");
        if (communityPage && topBar) {
            communityPage.insertBefore(header, topBar.nextSibling);
        }

        addAdminCustomizationUI(header, communityId, editBtn);
    }).catch(error => console.error("Error creating header:", error));
}

// Apply base styles to text container
function applyTextStyles(element, config) {
    element.style.fontFamily = config.font;
    element.style.color = config.textColor;
    element.style.fontSize = config.fontSize;
    element.style.padding = "15px";
    element.style.textAlign = "center";
    element.style.lineHeight = "1.5";
    element.style.transition = "max-height 0.5s ease, opacity 0.3s ease";
}

// Fetch custom settings from Firestore
async function fetchCustomSettings(communityId) {
    try {
        const db = getFirestore();
        const commRef = doc(db, "communities", communityId);
        const commDoc = await getDoc(commRef);
        return commDoc.exists() ? commDoc.data().customHeader || null : null;
    } catch (error) {
        console.error("Error fetching settings:", error);
        return null;
    }
}

// Add admin customization UI
function addAdminCustomizationUI(header, communityId, editBtn) {
    const user = getAuth().currentUser;
    if (!user) return;

    const commRef = doc(getFirestore(), "communities", communityId);
    getDoc(commRef).then(commDoc => {
        const commData = commDoc.data();
        const isAdmin = commData?.admins?.includes(user.uid) || commData?.creatorId === user.uid;
        if (!isAdmin) return;

        const textContainer = header.querySelector(".header-text");
        const toggleBtn = header.querySelector(".toggle-btn");
        let originalConfig = {};

        const updateOriginalConfig = () => {
            fetchCustomSettings(communityId).then(config => {
                originalConfig = config ? { ...config } : {
                    message: "Welcome!\nFollow the rules\nOr get banned!",
                    font: "Roboto",
                    bgColor: "#ffcccc",
                    textColor: "#333",
                    fontSize: "17px"
                };
            });
        };
        updateOriginalConfig();

        editBtn.onclick = () => {
            if (document.getElementById("header-toolbar")) return;
            textContainer.contentEditable = true;
            textContainer.focus();
            toggleBtn.style.display = "none";

            const toolbar = document.createElement("div");
            toolbar.id = "header-toolbar";
            toolbar.innerHTML = `
                <button id="bold-btn" title="Bold"><b>B</b></button>
                <button id="italic-btn" title="Italic"><i>I</i></button>
                <button id="underline-btn" title="Underline"><u>U</u></button>
                <select id="font-size">
                    ${[12, 14, 16, 18, 20, 24, 28, 32].map(size => 
                        `<option value="${size}px" ${textContainer.style.fontSize === `${size}px` ? "selected" : ""}>${size}</option>`
                    ).join("")}
                </select>
                <select id="header-font">
                    ${googleFonts.map(font => 
                        `<option value="${font}" ${textContainer.style.fontFamily === font ? "selected" : ""}>${font}</option>`
                    ).join("")}
                </select>
                <input type="color" id="header-textcolor" value="${rgbToHex(textContainer.style.color)}" title="Text Color">
                <input type="color" id="header-bgcolor" value="${rgbToHex(header.style.backgroundColor)}" title="Background Color">
                <button id="save-header">Save</button>
                <button id="cancel-header">Cancel</button>
            `;
            header.insertBefore(toolbar, textContainer);

            const boldBtn = document.getElementById("bold-btn");
            const italicBtn = document.getElementById("italic-btn");
            const underlineBtn = document.getElementById("underline-btn");
            const fontSizeSelect = document.getElementById("font-size");
            const fontSelect = document.getElementById("header-font");
            const textColorInput = document.getElementById("header-textcolor");
            const bgColorInput = document.getElementById("header-bgcolor");

            // Apply styles to selection only
            boldBtn.onclick = () => {
                document.execCommand("bold", false, null);
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            italicBtn.onclick = () => {
                document.execCommand("italic", false, null);
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            underlineBtn.onclick = () => {
                document.execCommand("underline", false, null);
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            fontSizeSelect.onchange = (e) => {
                document.execCommand("fontSize", false, "7"); // Temporary large size
                const selection = window.getSelection();
                if (selection.rangeCount) {
                    const range = selection.getRangeAt(0);
                    const spans = range.commonAncestorContainer.parentElement.querySelectorAll("font[size='7']");
                    spans.forEach(span => {
                        span.style.fontSize = e.target.value;
                        span.removeAttribute("size");
                        span.tagName = "SPAN"; // Convert to span
                    });
                }
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            fontSelect.onchange = (e) => {
                document.execCommand("fontName", false, e.target.value);
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            textColorInput.oninput = (e) => {
                document.execCommand("foreColor", false, e.target.value);
                updateButtonStates(boldBtn, italicBtn, underlineBtn);
            };
            bgColorInput.oninput = (e) => header.style.backgroundColor = e.target.value;

            // Update button states on selection change
            textContainer.addEventListener("mouseup", () => updateButtonStates(boldBtn, italicBtn, underlineBtn));
            textContainer.addEventListener("keyup", () => updateButtonStates(boldBtn, italicBtn, underlineBtn));
            updateButtonStates(boldBtn, italicBtn, underlineBtn);

            document.getElementById("save-header").onclick = () => {
                saveHeaderConfig(header, communityId).then(() => {
                    updateOriginalConfig();
                    if (textContainer.scrollHeight > 50) {
                        textContainer.classList.add("collapsed");
                        textContainer.style.maxHeight = "50px";
                        toggleBtn.style.display = "block";
                    } else {
                        toggleBtn.style.display = "none";
                    }
                });
            };
            document.getElementById("cancel-header").onclick = () => {
                textContainer.innerHTML = parseLinksAndEmails(originalConfig.message).replace(/\n/g, "<br>");
                applyTextStyles(textContainer, originalConfig);
                header.style.backgroundColor = originalConfig.bgColor;
                textContainer.contentEditable = false;
                toolbar.remove();
                if (textContainer.scrollHeight > 50) {
                    textContainer.classList.add("collapsed");
                    textContainer.style.maxHeight = "50px";
                    toggleBtn.style.display = "block";
                } else {
                    toggleBtn.style.display = "none";
                }
            };
        };
    }).catch(error => console.error("Error checking admin status:", error));
}

// Update button states based on selection
function updateButtonStates(boldBtn, italicBtn, underlineBtn) {
    const selection = window.getSelection();
    if (selection.rangeCount) {
        const range = selection.getRangeAt(0);
        const parent = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
        const styles = window.getComputedStyle(parent);
        boldBtn.classList.toggle("active", styles.fontWeight === "bold" || parseInt(styles.fontWeight) >= 700);
        italicBtn.classList.toggle("active", styles.fontStyle === "italic");
        underlineBtn.classList.toggle("active", styles.textDecoration.includes("underline"));
    } else {
        boldBtn.classList.remove("active");
        italicBtn.classList.remove("active");
        underlineBtn.classList.remove("active");
    }
}

// Save header config to Firestore
async function saveHeaderConfig(header, communityId) {
    const textContainer = header.querySelector(".header-text");
    const config = {
        message: textContainer.innerHTML, // Save full HTML
        font: textContainer.style.fontFamily || "Roboto",
        bgColor: header.style.backgroundColor || "#ffcccc",
        textColor: textContainer.style.color || "#333",
        fontSize: textContainer.style.fontSize || "17px"
    };

    textContainer.innerHTML = parseLinksAndEmails(config.message); // Reapply links on save
    applyTextStyles(textContainer, config);
    header.style.backgroundColor = config.bgColor;

    textContainer.contentEditable = false;
    const toolbar = document.getElementById("header-toolbar");
    if (toolbar) toolbar.remove();

    try {
        const db = getFirestore();
        await updateDoc(doc(db, "communities", communityId), { customHeader: config });
        return Promise.resolve();
    } catch (error) {
        console.error("Error saving header config:", error);
        return Promise.reject(error);
    }
}

// Convert RGB to Hex
function rgbToHex(rgb) {
    if (!rgb || rgb === "transparent") return "#000000";
    if (rgb.startsWith("#")) return rgb;
    const matches = rgb.match(/\d+/g);
    if (!matches) return "#000000";
    const [r, g, b] = matches.map(Number);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Initialize on DOM load
document.addEventListener("DOMContentLoaded", () => {
    createCustomHeader();
});