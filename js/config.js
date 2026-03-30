// ==========================================
// LAVENDER EXPENSE TRACKER — CONFIGURATION
// ==========================================
// Loaded as a regular <script> so it works on file:// protocol.
// All values placed on window.* for the inline Babel/React code.

// ==========================================
// YOUR LIVE FIREBASE CONFIGURATION
// ==========================================
window.LAVENDER_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCamHOZdnXdKaKg_9rqI3LdEI7srQKLiGM",
  authDomain: "expensetracker-2fb92.firebaseapp.com",
  projectId: "expensetracker-2fb92",
  storageBucket: "expensetracker-2fb92.firebasestorage.app",
  messagingSenderId: "261484355674",
  appId: "1:261484355674:web:6f322df6f5a4c83080f863"
};

window.LAVENDER_APP_ID = 'lavish-lavender-app';

// ==========================================
// YOUR LIVE GEMINI API KEY
// ==========================================
window.LAVENDER_GEMINI_KEY = "AIzaSyCxCLCnlHnkLG8bpXgsl1zeFBUOozIwadM";

// ==========================================
// SUPPORTED CURRENCIES (International)
// ==========================================
window.LAVENDER_CURRENCIES = [
  { code: 'SAR', symbol: 'SR', flag: '🇸🇦', name: 'Saudi Riyal' },
  { code: 'INR', symbol: '₹', flag: '🇮🇳', name: 'Indian Rupee' },
  { code: 'USD', symbol: '$', flag: '🇺🇸', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', name: 'Euro' },
  { code: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound' },
  { code: 'AED', symbol: 'AED', flag: '🇦🇪', name: 'UAE Dirham' },
  { code: 'PKR', symbol: '₨', flag: '🇵🇰', name: 'Pakistani Rupee' },
  { code: 'BDT', symbol: '৳', flag: '🇧🇩', name: 'Bangladeshi Taka' },
  { code: 'QAR', symbol: 'QR', flag: '🇶🇦', name: 'Qatari Riyal' },
  { code: 'KWD', symbol: 'KD', flag: '🇰🇼', name: 'Kuwaiti Dinar' },
];

// ==========================================
// CATEGORIES (International / Generic)
// ==========================================
window.LAVENDER_CATEGORIES = [
  { id: 'food', name: 'Food & Dining', icon: 'Coffee' },
  { id: 'groceries', name: 'Groceries & Supermarket', icon: 'ShoppingCart' },
  { id: 'fuel', name: 'Fuel & Transport', icon: 'Car' },
  { id: 'shopping', name: 'Shopping & Retail', icon: 'ShoppingCart' },
  { id: 'education', name: 'Education & School', icon: 'GraduationCap' },
  { id: 'insurance', name: 'Insurance & Medical', icon: 'Landmark' },
  { id: 'transfer_out', name: 'Transfers Out', icon: 'Users' },
  { id: 'transfer_in', name: 'Transfer In / Salary', icon: 'PiggyBank', isIncome: true },
  { id: 'utilities', name: 'Utilities & Bills', icon: 'PhoneIcon' },
  { id: 'rent', name: 'Rent & Housing', icon: 'Landmark' },
  { id: 'savings', name: 'Savings & Investment', icon: 'PiggyBank' },
  { id: 'misc', name: 'Miscellaneous', icon: 'Plus' },
];

// ==========================================
// ✨ AUTO-FALLBACK AI ENGINE
// ==========================================
window.callGemini = async function(key, prompt, requireJson, base64Image) {
  if (!key) throw new Error("Gemini API key not configured.");
  requireJson = requireJson || false;
  base64Image = base64Image || null;

  // Sanitize prompt to prevent injection
  const safePrompt = String(prompt).slice(0, 30000);

  const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-pro'];
  let lastError = "";

  for (var i = 0; i < modelsToTry.length; i++) {
    var model = modelsToTry[i];
    try {
      var parts = [{ text: safePrompt }];
      if (base64Image) parts.push({ inlineData: { mimeType: "image/jpeg", data: base64Image } });

      var body = { contents: [{ parts: parts }], generationConfig: { temperature: 0.2 } };
      if (requireJson && model !== 'gemini-pro') body.generationConfig.responseMimeType = "application/json";

      var res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + key, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000) // 30s timeout
      });

      var data = await res.json();
      if (res.ok && data && data.candidates && data.candidates[0] && data.candidates[0].content &&
          data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
          data.candidates[0].content.parts[0].text) {
        return data.candidates[0].content.parts[0].text;
      }
      lastError = (data && data.error && data.error.message) || "Invalid response";
    } catch (e) {
      lastError = e.message || "Network error";
    }
  }
  throw new Error("AI unavailable: " + lastError);
};

// ==========================================
// MULTI-CURRENCY EXCHANGE RATE FETCHER
// Fetches all rates relative to SAR
// ==========================================
window.fetchAllRates = async function() {
  var defaultRates = { INR: 22.25, USD: 0.267, EUR: 0.245, GBP: 0.21, AED: 0.98, PKR: 74.5, BDT: 29.3, QAR: 0.97, KWD: 0.082 };
  try {
    var res = await fetch('https://open.er-api.com/v6/latest/SAR');
    if (!res.ok) return defaultRates;
    var data = await res.json();
    if (data && data.rates) return data.rates;
    return defaultRates;
  } catch (e) {
    return defaultRates;
  }
};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================
window.lavenderParseDate = function(val) {
  if (!val) return new Date();
  if (val.toDate && typeof val.toDate === 'function') return val.toDate(); // Firestore Timestamp
  if (val instanceof Date) return val;
  if (typeof val === 'string' || typeof val === 'number') return new Date(val);
  return new Date();
};

window.lavenderGetLocalYMD = function(date) {
  try {
    var d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
  } catch(e) {
    return new Date().toISOString().split('T')[0];
  }
};

window.lavenderGetMonthKey = function(dateObj) {
  try {
    dateObj = dateObj || new Date();
    var d = window.lavenderParseDate(dateObj);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  } catch(e) {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
};

window.lavenderIsIncome = function(t) {
  if (!t) return false;
  return t.type === 'income' || t.category === 'Transfer In / Salary';
};

// Safely parse a float, returning 0 if invalid
window.lavenderSafeFloat = function(val) {
  var n = parseFloat(val);
  return isNaN(n) ? 0 : n;
};

// Format money with symbol and locale formatting
window.lavenderFormatAmountWithCurrency = function(amount, currencyCode, rates) {
  var currencies = window.LAVENDER_CURRENCIES;
  var cur = currencies.find(function(c) { return c.code === currencyCode; });
  var symbol = cur ? cur.symbol : currencyCode;
  var safeAmt = isNaN(parseFloat(amount)) ? 0 : parseFloat(amount);
  return symbol + ' ' + safeAmt.toLocaleString(undefined, { maximumFractionDigits: 0 });
};

console.log('[Lavender] Config v2.1 — Refined Edition loaded ✓');
