import { getFirestore, doc, getDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Load cool Google Fonts
const googleFonts = [
    "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", 
    "Oswald", "Raleway", "Merriweather", "Playfair Display", "Nunito",
    "Bebas Neue", "Lobster", "Pacifico", "Abril Fatface", "Dancing Script"
];
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css?family=" + googleFonts.join("|").replace(/ /g, "+");
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

// Function to parse text and make links/emails clickable
function parseLinksAndEmails(text) {
    // Replace URLs with <a> tags (http/https)
    const urlPattern = /(\bhttps?:\/\/[^\s<]+[^\s<.,!?;:])/gi;
    text = text.replace(urlPattern, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

    // Replace emails with mailto links
    const emailPattern = /(\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b)/gi;
    text = text.replace(emailPattern, '<a href="mailto:$1">$1</a>');

    return text;
}

// Function to create and style the custom header
function createCustomHeader() {
    if (document.getElementById("custom-header")) return;

    const communityId = new URLSearchParams(window.location.search).get("id");
    if (!communityId) return;

    let config = {
        message: "Welcome!\nFollow the rules\nOr get banned!",
        font: "Roboto",
        bgColor: "#ffcccc",
        textColor: "#333",
        isBold: false,
        isItalic: false
    };

    fetchCustomSettings(communityId).then(customConfig => {
        if (customConfig) config = { ...config, ...customConfig };

        const header = document.createElement("div");
        header.id = "custom-header";
        
        const textContainer = document.createElement("div");
        textContainer.className = "header-text";
        // Parse links and emails before rendering
        textContainer.innerHTML = parseLinksAndEmails(config.message).replace(/\n/g, "<br>");
        
        textContainer.classList.add("collapsed");
        const toggleBtn = document.createElement("button");
        toggleBtn.textContent = "See more";
        toggleBtn.className = "toggle-btn";
        toggleBtn.onclick = () => {
            // Store scroll position before transition
            const scrollY = window.scrollY;
            if (textContainer.classList.contains("collapsed")) {
                textContainer.classList.remove("collapsed");
                toggleBtn.textContent = "Hide";
            } else {
                textContainer.classList.add("collapsed");
                toggleBtn.textContent = "See more";
            }
            // Restore scroll position after transition
            window.scrollTo(0, scrollY);
        };

        header.appendChild(textContainer);
        header.appendChild(toggleBtn);
        header.style.fontFamily = config.font;
        header.style.backgroundColor = config.bgColor;
        header.style.color = config.textColor;
        header.style.padding = "15px";
        header.style.textAlign = "center";
        header.style.fontSize = "17px";
        header.style.lineHeight = "1.5";
        if (config.isBold) header.style.fontWeight = "bold";
        if (config.isItalic) header.style.fontStyle = "italic";

        const communityPage = document.querySelector(".community-page");
        const topBar = document.querySelector(".top-bar");
        if (communityPage && topBar) {
            communityPage.insertBefore(header, topBar.nextSibling);
        }

        addAdminCustomizationUI(header, communityId);
    });
}

// Fetch custom settings from Firestore
async function fetchCustomSettings(communityId) {
    const db = getFirestore();
    const commRef = doc(db, "communities", communityId);
    const commDoc = await getDoc(commRef);
    if (commDoc.exists()) {
        const data = commDoc.data();
        return data.customHeader || null;
    }
    return null;
}

// Add UI for admins to customize the header with live preview
function addAdminCustomizationUI(header, communityId) {
    const user = getAuth().currentUser;
    if (!user) return;

    const commRef = doc(getFirestore(), "communities", communityId);
    getDoc(commRef).then(commDoc => {
        const commData = commDoc.data();
        const isAdmin = commData.admins?.includes(user.uid) || commData.creatorId === user.uid;
        if (!isAdmin) return;

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit Header";
        editBtn.className = "edit-header-btn";
        header.appendChild(editBtn);

        editBtn.onclick = () => {
            const textContainer = header.querySelector(".header-text");
            const currentMessage = textContainer.innerText;
            const form = document.createElement("div");
            form.id = "header-edit-form";
            form.innerHTML = `
                <br><br>
                <label>Message (use Enter for new lines):<br>
                    <textarea id="header-message" rows="4">${currentMessage}</textarea>
                </label><br>
                <label>Font:<br> 
                    <select id="header-font">
                        ${googleFonts.map(font => 
                            `<option value="${font}" ${header.style.fontFamily === font ? "selected" : ""}>${font}</option>`
                        ).join("")}
                    </select>
                </label><br>
                <label>Background Color:<br> 
                    <input type="color" id="header-bgcolor" value="${rgbToHex(header.style.backgroundColor)}"><br>
                    <span id="bg-preview" style="display:inline-block; width:20px; height:20px; vertical-align:middle;"></span>
                </label><br>
                <label>Text Color:<br> 
                    <input type="color" id="header-textcolor" value="${rgbToHex(header.style.color)}"><br>
                    <span id="text-preview" style="display:inline-block; width:20px; height:20px; vertical-align:middle;"></span>
                </label><br>
                <div class="bold-ita">
                <label>Bold: <input type="checkbox" id="header-bold" ${header.style.fontWeight === "bold" ? "checked" : ""}></label>
                <label>Italic: <input type="checkbox" id="header-italic" ${header.style.fontStyle === "italic" ? "checked" : ""}></label>
                </div><br>
                <button id="save-header">Save</button>
                <button id="cancel-header">Cancel</button>
                <br><br>
            `;
            header.appendChild(form);

            // Live preview setup
            const fontSelect = document.getElementById("header-font");
            const bgColorInput = document.getElementById("header-bgcolor");
            const textColorInput = document.getElementById("header-textcolor");
            const boldCheckbox = document.getElementById("header-bold");
            const italicCheckbox = document.getElementById("header-italic");
            const bgPreview = document.getElementById("bg-preview");
            const textPreview = document.getElementById("text-preview");

            // Initial preview states
            bgPreview.style.backgroundColor = bgColorInput.value;
            textPreview.style.backgroundColor = textColorInput.value;

            // Live updates for font
            fontSelect.onchange = () => {
                header.style.fontFamily = fontSelect.value;
            };

            // Live updates for colors
            bgColorInput.oninput = () => {
                bgPreview.style.backgroundColor = bgColorInput.value;
                header.style.backgroundColor = bgColorInput.value;
            };
            textColorInput.oninput = () => {
                textPreview.style.backgroundColor = textColorInput.value;
                header.style.color = textColorInput.value;
            };

            // Live updates for bold and italic
            boldCheckbox.onchange = () => {
                header.style.fontWeight = boldCheckbox.checked ? "bold" : "normal";
            };
            italicCheckbox.onchange = () => {
                header.style.fontStyle = italicCheckbox.checked ? "italic" : "normal";
            };

            // Save and cancel handlers
            document.getElementById("save-header").onclick = () => saveHeaderConfig(header, communityId);
            document.getElementById("cancel-header").onclick = () => {
                // Reset to original styles on cancel (optional)
                fetchCustomSettings(communityId).then(config => {
                    if (config) {
                        header.style.fontFamily = config.font;
                        header.style.backgroundColor = config.bgColor;
                        header.style.color = config.textColor;
                        header.style.fontWeight = config.isBold ? "bold" : "normal";
                        header.style.fontStyle = config.isItalic ? "italic" : "normal";
                    }
                });
                form.remove();
            };
        };
    });
}

// Save the custom settings to Firestore
async function saveHeaderConfig(header, communityId) {
    const config = {
        message: document.getElementById("header-message").value,
        font: document.getElementById("header-font").value,
        bgColor: document.getElementById("header-bgcolor").value,
        textColor: document.getElementById("header-textcolor").value,
        isBold: document.getElementById("header-bold").checked,
        isItalic: document.getElementById("header-italic").checked
    };

    const textContainer = header.querySelector(".header-text");
    textContainer.innerHTML = parseLinksAndEmails(config.message).replace(/\n/g, "<br>");
    header.style.fontFamily = config.font;
    header.style.backgroundColor = config.bgColor;
    header.style.color = config.textColor;
    header.style.fontWeight = config.isBold ? "bold" : "normal";
    header.style.fontStyle = config.isItalic ? "italic" : "normal";

    textContainer.classList.add("collapsed");
    const toggleBtn = header.querySelector(".toggle-btn");
    if (toggleBtn) toggleBtn.textContent = "See more";

    const db = getFirestore();
    await updateDoc(doc(db, "communities", communityId), { customHeader: config });
    document.getElementById("header-edit-form").remove();
}

// Convert RGB to Hex for color inputs
function rgbToHex(rgb) {
    if (!rgb || rgb === "transparent") return "#000000";
    const matches = rgb.match(/\d+/g);
    if (!matches) return "#000000";
    const [r, g, b] = matches.map(Number);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Run when the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    createCustomHeader();
});