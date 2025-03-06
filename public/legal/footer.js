// ======== Team Life Swap - Auto Footer & Console Warning ========

// Function to create the footer
function createFooter() {
  const footer = document.createElement("footer");
  footer.innerHTML = `
    <div class="footer-content">
      <p>&copy; ${new Date().getFullYear()} <span style="color: rgba(172, 255, 47, 0.881);">Life Swap</span>. All rights reserved.</p>
      <p>Swap your way, no money, just value.</p>
      <p>Need help? <a href="../contact.html">Contact</a> | <a href="../index.html">Home</a> </p>
    </div>
  `;
  document.body.appendChild(footer);
}

// Inject CSS for the footer
const style = document.createElement("style");
style.innerHTML = `
  footer {
    background: #222;
    border-radius: 10px;
    color: #fff;
    text-align: center;
    padding: 20px;
    font-size: 0.9rem;
    position: relative;
    box-shadow: inset -5px 5px 9px rgba(0, 0, 0, 0.5);
    bottom: 0;
    margin-top: 40px;
    z-index: -1;
  }
  .footer-content {
    max-width: 1200px;
    margin: 0 auto;
  }
`;
document.head.appendChild(style);

// Add the footer when the page loads
window.addEventListener("load", createFooter);

// ======== Console Warning ========

setTimeout(() => {
  console.log(
    "%cSTOP! ✋", 
    "color: red; font-size: 40px; font-weight: bold; text-shadow: 2px 2px 5px black;"
  );
  console.log(
    "%cIf someone told you to paste something here, they're trying to hack you!",
    "color: yellow; font-size: 16px;"
  );
  console.log(
    "%cNever paste code you don't understand. You could lose your account or compromise your security.",
    "color: white; font-size: 14px;"
  );
  console.log(
    "%cTeam Life Swap ❤️",
    "color: cyan; font-size: 14px;"
  );
}, 2000); // Show warning after 2 seconds

// ======== Alert for Users Opening Console ========
//window.addEventListener("devtoolschange", event => {
  //if (event.detail.open) {
    //alert("⚠️ WARNING: Do not paste anything here! It could be a security risk. - Team Life Swap");
  //}
//});

// DevTools Detector (Triggers the alert)
(function detectDevTools() {
  let threshold = 160;
  let check = setInterval(() => {
    let widthThreshold = window.outerWidth - window.innerWidth > threshold;
    let heightThreshold = window.outerHeight - window.innerHeight > threshold;
    if (widthThreshold || heightThreshold) {
      window.dispatchEvent(new CustomEvent("devtoolschange", { detail: { open: true } }));
      clearInterval(check);
    }
  }, 500);
})();
