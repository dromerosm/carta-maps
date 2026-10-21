// Google Analytics 4 for the shared diegoromero.es property. Same-origin so the
// hash-based CSP needs no 'unsafe-inline'; gtag.js itself loads from googletagmanager.com.
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag("js", new Date());
// Visit any page with ?internal=1 once per browser to exclude your own
// traffic (GA4 "Internal Traffic" filter); ?internal=0 undoes it.
const isInternalTraffic = (() => {
  try {
    const flag = new URLSearchParams(location.search).get("internal");
    if (flag === "1") localStorage.setItem("ga_internal", "1");
    if (flag === "0") localStorage.removeItem("ga_internal");
    return localStorage.getItem("ga_internal") === "1";
  } catch { return false; }
})();
gtag("config", "G-B8118TCBQY", {
  anonymize_ip: true,
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
  ...(isInternalTraffic && { traffic_type: "internal" }),
});
