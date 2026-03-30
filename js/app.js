import React, { useState, useEffect, useMemo, useRef } from "react";
import ReactDOM from "react-dom/client";
import htm from "htm";

// Firebase Imports (Resolved via Import Map)
import { 
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, 
  query, orderBy, serverTimestamp 
} from "firebase/firestore";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";

// Initialized Services from firebase.js
import { auth, db } from "./firebase.js";

// Bind HTM to React's createElement
const html = htm.bind(React.createElement);

// ==========================================
// CONSTANTS & CATEGORIES
// ==========================================
const appId = 'lavish-lavender-decision-v4';

const CATEGORIES = [
  { id: 'food', name: 'Food & Dining', icon: 'Coffee' },
  { id: 'groceries', name: 'Groceries / Hawwa Mart', icon: 'ShoppingCart' },
  { id: 'fuel', name: 'Fuel / Auto', icon: 'Car' },
  { id: 'shopping', name: 'Shopping', icon: 'ShoppingCart' },
  { id: 'education', name: 'Education (JSI School)', icon: 'GraduationCap' },
  { id: 'insurance', name: 'Insurance (TALIC)', icon: 'Landmark' },
  { id: 'transfer_out', name: 'Transfers Out', icon: 'Users' },
  { id: 'transfer_in', name: 'Transfer In / Salary', icon: 'PiggyBank', isIncome: true },
  { id: 'utilities', name: 'Utilities / Recharge', icon: 'Smartphone' },
  { id: 'misc', name: 'Miscellaneous', icon: 'Plus' }
];

// ==========================================
// LUCIDE ICON HELPER (Injected via UMD)
// ==========================================
const Icon = ({ name, size = 24, className = "", strokeWidth = 2 }) => {
  const iconRef = useRef(null);
  useEffect(() => {
    if (iconRef.current && window.lucide) {
      const iconName = name.replace(/([A-Z])/g, "-$1").toLowerCase().replace(/^-/, "");
      const icon = lucide.icons[iconName] || lucide.icons["circle"];
      if (icon) {
        iconRef.current.innerHTML = icon.toSvg({ width: size, height: size, "stroke-width": strokeWidth, class: className });
      }
    }
  }, [name, size, className, strokeWidth]);
  return html`<span ref=${iconRef} className="inline-flex items-center justify-center"></span>`;
};

// ==========================================
// GLOBAL HELPERS
// ==========================================
const parseDate = d => {
  if (!d) return new Date();
  if (typeof d.seconds === 'number') return new Date(d.seconds * 1000);
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
};

const getLocalYMD = date => {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  const localDate = new Date(d.getTime() - (offset * 60 * 1000));
  return localDate.toISOString().split('T')[0];
};

const getMonthKey = (dateObj = new Date()) => {
  const d = parseDate(dateObj);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const isIncome = t => t.type === 'income' || t.category === 'Transfer In / Salary';

// ==========================================
// CUSTOM HOOKS
// ==========================================
function useExchangeRate(defaultRate = 22.25) {
  const [exchangeRate, setExchangeRate] = useState(defaultRate);
  useEffect(() => {
    fetch('https://open.er-api.com/v6/latest/SAR')
      .then(res => res.json())
      .then(data => { if (data?.rates?.INR) setExchangeRate(data.rates.INR); })
      .catch(() => console.warn("Exchange rate fetch failed. Fallback: " + defaultRate));
  }, []);
  return exchangeRate;
}

function useStats(transactions, commitments, debts, settings, exchangeRate) {
  return useMemo(() => {
    const currentMonthKey = getMonthKey();
    const todayStr = new Date().toDateString();
    const lastDay = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const toSAR = (amount, currency) => currency === 'SAR' ? parseFloat(amount) : parseFloat(amount) / exchangeRate;
    
    let incSAR = 0, expSAR = 0, todaySpendSAR = 0;
    const categoryTotals = {};

    transactions.forEach(t => {
      if (t.monthKey !== currentMonthKey) return;
      const valSAR = toSAR(t.amount, t.currency);
      if (isIncome(t)) incSAR += valSAR;
      else {
        expSAR += valSAR;
        if (parseDate(t.date).toDateString() === todayStr) todaySpendSAR += valSAR;
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + valSAR;
      }
    });

    const baseIncome = (parseFloat(settings.salary) || 0) > 0 ? parseFloat(settings.salary) : incSAR;
    const lockedSavings = baseIncome * ((parseFloat(settings.savingsPercent) || 30) / 100);

    let unpaidCommitmentsSAR = 0;
    const commitmentList = commitments.map(c => {
      const amtSAR = toSAR(c.amount, c.currency);
      const paidAmtSAR = transactions
        .filter(t => t.commitmentId === c.id && t.monthKey === currentMonthKey)
        .reduce((sum, t) => sum + toSAR(t.amount, t.currency), 0);
      const remaining = Math.max(0, amtSAR - paidAmtSAR);
      unpaidCommitmentsSAR += remaining;
      return { ...c, isPaid: paidAmtSAR >= amtSAR, remainingSAR: remaining };
    });

    const pool = baseIncome - (lockedSavings + commitments.reduce((sum, c) => sum + toSAR(c.amount, c.currency), 0));
    const dailyAllowance = Math.max(0, pool / lastDay);
    const leftToday = dailyAllowance - todaySpendSAR;

    const realtimeDebts = debts.map(acc => {
      let balance = toSAR(acc.amount, acc.currency); 
      transactions.forEach(t => {
        if (t.accountId === acc.id) {
          const v = toSAR(t.amount, t.currency);
          if (acc.type === 'debt') balance += isIncome(t) ? -v : v;
          else balance += isIncome(t) ? v : -v;
        }
      });
      return { ...acc, realtimeBalanceSAR: balance };
    });

    return { 
      leftForToday: leftToday, dailyAllowance, todaySpendSAR,
      incSAR: baseIncome, expSAR, lockedSavings, 
      unpaidCommitmentsSAR, commitmentList, realtimeDebts, categoryTotals,
      health: leftToday < 0 ? "red" : leftToday < (dailyAllowance * 0.2) ? "yellow" : "green"
    };
  }, [transactions, commitments, debts, settings, exchangeRate]);
}

// ==========================================
// SUB-COMPONENTS (TABS)
// ==========================================
function DashboardTab({ stats, formatMoney, settings }) {
  return html`
    <div className="space-y-6 animate-in">
      <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white space-y-8 shadow-2xl relative overflow-hidden">
         <div className="absolute top-0 right-0 w-40 h-40 bg-purple-500/20 rounded-full -mr-20 -mt-20 blur-3xl"></div>
         <div className="space-y-1 relative z-10">
            <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">Remaining Today</p>
            <h2 className=${`text-5xl font-black font-heading tracking-tighter leading-none ${stats.leftForToday < 0 ? 'text-rose-400' : 'text-white'}`}>
              ${formatMoney(stats.leftForToday)}
            </h2>
         </div>
         <div className="grid grid-cols-2 gap-3 relative z-10">
            <div className="bg-white/5 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Daily Limit</p>
              <p className="text-lg font-black mt-1.5 text-white">${formatMoney(stats.dailyAllowance)}</p>
            </div>
            <div className="bg-white/5 p-4 rounded-3xl border border-white/10 backdrop-blur-md">
              <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Saving (${settings.savingsPercent || 30}%)</p>
              <p className="text-lg font-black mt-1.5 text-emerald-400">${formatMoney(stats.lockedSavings)}</p>
            </div>
         </div>
      </div>
      <div className="bg-white p-6 rounded-[2rem] border border-slate-200 shadow-sm flex items-center justify-between">
         <div className="flex items-center gap-4">
            <div className=${`p-4 rounded-2xl ${stats.health === 'green' ? 'bg-emerald-50 text-emerald-600' : stats.health === 'yellow' ? 'bg-amber-50 text-amber-600' : 'bg-rose-50 text-rose-600'}`}>
                <${Icon} name="Activity" size="24" />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Spent Today</p>
              <p className="text-2xl font-black text-slate-800 font-heading tracking-tight">${formatMoney(stats.todaySpendSAR)}</p>
            </div>
         </div>
      </div>
    </div>
  `;
}

function LogsTab({ transactions, formatMoney, setEditingItem, setShowAddModal, setConfirmDelete }) {
  const [searchTerm, setSearchTerm] = useState("");
  const currentMonthKey = getMonthKey();
  const filteredLogs = transactions
    .filter(t => t.monthKey === currentMonthKey)
    .filter(t => searchTerm === "" || t.merchant?.toLowerCase().includes(searchTerm.toLowerCase()) || t.category?.toLowerCase().includes(searchTerm.toLowerCase()));

  return html`
    <div className="space-y-4 pb-20 animate-in">
      <h2 className="text-xl font-black px-1 flex justify-between items-center font-heading">
        History <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-1 rounded-lg">Month: ${currentMonthKey}</span>
      </h2>
      <div className="relative">
        <${Icon} name="Search" className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size="18"/>
        <input 
          type="text" placeholder="Search logs..." value=${searchTerm} onChange=${(e) => setSearchTerm(e.target.value)}
          className="w-full bg-white p-4 pl-12 rounded-2xl border border-slate-200 outline-none font-bold text-sm shadow-sm focus:border-indigo-400 transition-all font-heading"
        />
      </div>
      <div className="space-y-3">
        ${filteredLogs.map(t => {
          const cat = CATEGORIES.find(c => c.name === t.category);
          const isInc = isIncome(t);
          return html`
            <div key=${t.id} className="bg-white p-5 rounded-[2rem] flex flex-col gap-4 border border-slate-200 shadow-sm transition-all hover:border-slate-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className=${`w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm ${isInc ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-600'}`}>
                    <${Icon} name=${cat?.icon || 'Plus'} size="20"/>
                  </div>
                  <div className="overflow-hidden">
                    <p className="font-bold text-base text-slate-800 leading-tight truncate w-32 font-heading">${t.merchant || 'Untitled'}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">${t.category}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className=${`font-black text-lg font-heading ${isInc ? 'text-emerald-600' : 'text-slate-900'}`}>${isInc ? '+' : '-'}${t.amount}</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase">${t.currency}</p>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-50">
                <button onClick=${() => { setEditingItem(t); setShowAddModal(true); }} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-widest active-scale transition-all hover:bg-white"><${Icon} name="Edit3" size="14"/> Edit</button>
                <button onClick=${() => setConfirmDelete({ col: 'transactions', id: t.id, title: 'Transaction' })} className="flex items-center gap-1.5 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl font-black text-[10px] uppercase tracking-widest active-scale transition-all hover:bg-white"><${Icon} name="Trash2" size="14"/> Delete</button>
              </div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// ==========================================
// MAIN APPLICATION
// ==========================================
function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currency, setCurrency] = useState('SAR'); 
  const [transactions, setTransactions] = useState([]);
  const [debts, setDebts] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [settings, setSettings] = useState({ salary: 0, savingsPercent: 30 });
  
  // Modals & UI
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [showCommitmentModal, setShowCommitmentModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const exchangeRate = useExchangeRate();
  const stats = useStats(transactions, commitments, debts, settings, exchangeRate);

  const formatMoney = amountSAR => {
    const val = currency === 'SAR' ? amountSAR : amountSAR * exchangeRate;
    const sym = currency === 'SAR' ? 'SR' : '₹';
    return `${sym} ${Math.round(val).toLocaleString()}`;
  };

  const showToast = (message, type = 'success') => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const h1 = () => setIsOnline(true); const h2 = () => setIsOnline(false);
    window.addEventListener('online', h1); window.addEventListener('offline', h2);
    return () => { window.removeEventListener('online', h1); window.removeEventListener('offline', h2); };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } catch (err) { console.error("Firebase Auth Fail:", err); }
    };
    initAuth();
    return onAuthStateChanged(auth, u => { setUser(u); setLoading(false); });
  }, []);

  useEffect(() => {
    if (!user) return;
    const pathBase = `artifacts/${appId}/users/${user.uid}`;
    
    const unsubTrans = onSnapshot(query(collection(db, `${pathBase}/transactions`), orderBy('date', 'desc')), s => 
      setTransactions(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubDebts = onSnapshot(collection(db, `${pathBase}/debts`), s => 
      setDebts(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubCommit = onSnapshot(collection(db, `${pathBase}/commitments`), s => 
      setCommitments(s.docs.map(d => ({ id: d.id, ...d.data() })))
    );
    const unsubSettings = onSnapshot(doc(db, `${pathBase}/settings/config`), d => { if (d.exists()) setSettings(d.data()); });
    
    return () => { unsubTrans(); unsubDebts(); unsubCommit(); unsubSettings(); };
  }, [user]);

  const saveTransaction = async e => {
    e.preventDefault();
    if (!user) return;
    const fd = new FormData(e.target);
    const amt = parseFloat(fd.get('amount'));
    if (!amt) return showToast("Enter amount", "error");

    const tData = {
      amount: amt, 
      currency: fd.get('currency'),
      merchant: fd.get('merchant') || "Misc",
      category: fd.get('category'),
      type: fd.get('type'),
      accountId: fd.get('accountId') || null,
      commitmentId: fd.get('commitmentId') || null,
      date: editingItem ? parseDate(editingItem.date) : new Date(fd.get('date')),
      monthKey: getMonthKey(editingItem ? parseDate(editingItem.date) : new Date(fd.get('date'))),
      updatedAt: serverTimestamp()
    };

    try {
      const path = `artifacts/${appId}/users/${user.uid}/transactions`;
      if (editingItem) await updateDoc(doc(db, path, editingItem.id), tData);
      else await addDoc(collection(db, path), { ...tData, createdAt: serverTimestamp() });
      showToast("Cloud Synced");
    } catch (err) { showToast("Sync Error", "error"); }
    setShowAddModal(false); setEditingItem(null);
  };

  const dbDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteDoc(doc(db, `artifacts/${appId}/users/${user.uid}/${confirmDelete.col}/${confirmDelete.id}`));
      showToast("Entry Erased");
    } catch (e) { showToast("Delete failed", "error"); }
    setConfirmDelete(null);
  };

  if (loading) return null; // Let the index.html loader handle it

  return html`
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-32 font-sans max-w-md mx-auto shadow-2xl relative overflow-x-hidden flex flex-col border-x border-slate-100">
      
      <header className="px-6 pt-10 pb-6 bg-white flex justify-between items-center sticky top-0 z-30 border-b border-slate-50 glass-morphism">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-900 rounded-xl flex items-center justify-center text-white shadow-lg active-scale"><${Icon} name="Wallet" size="20"/></div>
          <div>
            <h1 className="text-xl font-black font-heading tracking-tight">Lavender</h1>
            <div className="flex items-center gap-1.5 mt-0.5">
               <div className=${`w-1.5 h-1.5 rounded-full ${stats.health === 'green' ? 'bg-emerald-500' : stats.health === 'yellow' ? 'bg-amber-500' : 'bg-rose-500'}`}></div>
               <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">${stats.health === 'green' ? 'Stable' : stats.health === 'yellow' ? 'Warning' : 'Overspent'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
           <div className=${`p-2.5 rounded-xl ${isOnline ? 'text-emerald-500 bg-emerald-50' : 'text-rose-500 bg-rose-50'}`}><${Icon} name=${isOnline ? "Wifi" : "WifiOff"} size="16"/></div>
           <button onClick=${() => setCurrency(currency === 'SAR' ? 'INR' : 'SAR')} className="bg-slate-900 px-4 h-10 rounded-xl text-[10px] font-black text-white tracking-widest font-heading transition-all shadow-sm active-scale">${currency}</button>
        </div>
      </header>

      <main className="px-6 space-y-6 pt-6 flex-1">
        ${activeTab === 'dashboard' && html`<${DashboardTab} stats=${stats} formatMoney=${formatMoney} settings=${settings} />`}
        ${activeTab === 'logs' && html`<${LogsTab} transactions=${transactions} formatMoney=${formatMoney} setEditingItem=${setEditingItem} setShowAddModal=${setShowAddModal} setConfirmDelete=${setConfirmDelete} />`}
        
        ${activeTab === 'bills' && html`
          <div className="space-y-6 pb-20 animate-in">
            <div className="flex justify-between items-center px-1">
              <h2 className="text-xl font-black font-heading">Fixed Bills</h2>
              <button onClick=${() => setShowCommitmentModal(true)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase flex items-center gap-2 active-scale shadow-sm transition-all"><${Icon} name="Plus" size="16" /> Add</button>
            </div>
            <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white relative overflow-hidden">
               <p className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">Unpaid Balance</p>
               <h3 className="text-4xl font-black mt-1 font-heading">${formatMoney(stats.unpaidCommitmentsSAR)}</h3>
            </div>
            <div className="space-y-3">
              ${stats.commitmentList.map(item => html`
                <div key=${item.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-slate-50 rounded-2xl text-slate-400"><${Icon} name="LayoutList" size="20" /></div>
                    <div><p className="font-bold text-slate-800 font-heading leading-tight">${item.name}</p><p className="text-[10px] text-slate-400 font-black uppercase mt-1 tracking-widest">${item.amount} ${item.currency}</p></div>
                  </div>
                  <button onClick=${() => setConfirmDelete({ col: 'commitments', id: item.id, title: 'Bill' })} className="p-3 text-slate-200 hover:text-rose-500 active-scale"><${Icon} name="Trash2" size="16" /></button>
                </div>
              `)}
            </div>
          </div>
        `}

        ${activeTab === 'wealth' && html`
          <div className="space-y-6 pb-20 animate-in">
             <div className="flex justify-between items-center px-1">
               <h2 className="text-xl font-black font-heading">Vaults</h2>
               <button onClick=${() => setShowDebtModal(true)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase flex items-center gap-2 active-scale shadow-sm transition-all"><${Icon} name="Plus" size="16" /> Link</button>
             </div>
             <div className="space-y-3">
                ${stats.realtimeDebts.map(acc => html`
                  <div key=${acc.id} className="bg-white p-5 rounded-[2rem] border border-slate-100 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-slate-50 rounded-2xl text-slate-400"><${Icon} name=${acc.type === 'debt' ? 'CreditCard' : 'Landmark'} size="20" /></div>
                      <div><p className="font-bold text-slate-800 font-heading leading-tight">${acc.name}</p><p className="text-sm font-black text-slate-900 mt-1 font-heading">${formatMoney(acc.realtimeBalanceSAR)}</p></div>
                    </div>
                    <button onClick=${() => setConfirmDelete({ col: 'debts', id: acc.id, title: 'Account' })} className="p-3 text-slate-200 hover:text-rose-500 active-scale"><${Icon} name="Trash2" size="16" /></button>
                  </div>
                `)}
             </div>
          </div>
        `}

        ${activeTab === 'settings' && html`
          <div className="bg-white p-8 rounded-[2.5rem] shadow-sm border border-slate-100 space-y-8 animate-in">
             <h2 className="text-xl font-black font-heading">Profile</h2>
             <form onSubmit=${async e => {
                e.preventDefault();
                const fd = new FormData(e.target);
                await updateDoc(doc(db, `artifacts/${appId}/users/${user.uid}/settings/config`), {
                   salary: parseFloat(fd.get('salary')), savingsPercent: parseFloat(fd.get('savingsPercent'))
                }); showToast("Profile Updated");
             }} className="space-y-6">
                <input name="salary" type="number" step="0.1" defaultValue=${settings.salary} className="w-full bg-slate-50 p-5 rounded-2xl font-black text-lg outline-none font-heading" placeholder="Salary (SAR)" />
                <input name="savingsPercent" type="number" defaultValue=${settings.savingsPercent} className="w-full bg-slate-50 p-5 rounded-2xl font-black text-lg outline-none font-heading" placeholder="Savings %" />
                <button type="submit" className="w-full bg-slate-900 text-white p-5 rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-lg active-scale">Submit Update</button>
             </form>
          </div>
        `}
      </main>

      <footer className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white/95 backdrop-blur-xl border-t border-slate-100 px-8 py-5 flex justify-between items-center shadow-2xl z-40 pb-safe">
        ${['dashboard', 'logs', 'bills', 'wealth', 'settings'].map(tab => html`
          <button key=${tab} onClick=${() => setActiveTab(tab)} className=${`flex flex-col items-center gap-1.5 transition-all ${activeTab === tab ? 'text-purple-600 scale-110' : 'text-slate-300'}`}>
            <${Icon} name=${tab === 'dashboard' ? 'LayoutDashboard' : tab === 'logs' ? 'History' : tab === 'bills' ? 'List' : tab === 'wealth' ? 'Target' : 'User'} size="22" strokeWidth=${activeTab === tab ? 2.5 : 2}/><span className="text-[9px] font-black uppercase">${tab}</span>
          </button>
        `)}
      </footer>

      <button onClick=${() => setShowAddModal(true)} className="fixed bottom-24 left-1/2 translate-x-32 w-16 h-16 bg-slate-900 text-white rounded-full shadow-2xl flex items-center justify-center z-50 active-scale border-[4px] border-white ring-4 ring-slate-100"><${Icon} name="Plus" size="32" strokeWidth="3"/></button>

      ${showAddModal && html`
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center p-0 animate-in">
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl overflow-y-auto no-scrollbar pb-12">
            <h3 className="text-2xl font-black font-heading mb-8">${editingItem ? 'Edit Entry' : 'Log Entry'}</h3>
            <form key=${editingItem?.id || 'new'} onSubmit=${saveTransaction} className="space-y-6">
              <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                <label className="flex-1 cursor-pointer"><input type="radio" name="currency" value="SAR" className="hidden peer" defaultChecked=${editingItem ? editingItem.currency === 'SAR' : true} /><div className="text-center py-3.5 rounded-xl peer-checked:bg-slate-900 peer-checked:text-white font-black text-[10px] uppercase">SAR</div></label>
                <label className="flex-1 cursor-pointer"><input type="radio" name="currency" value="INR" className="hidden peer" defaultChecked=${editingItem?.currency === 'INR'} /><div className="text-center py-3.5 rounded-xl peer-checked:bg-slate-900 peer-checked:text-white font-black text-[10px] uppercase">INR</div></label>
              </div>
              <input name="amount" type="number" step="0.01" defaultValue=${editingItem?.amount} placeholder="0.00" className="w-full bg-slate-50 p-6 rounded-3xl font-black text-5xl text-center outline-none font-heading" autoFocus />
              <div className="grid grid-cols-1 gap-4">
                <select name="category" defaultValue=${editingItem?.category || "Misc"} className="w-full bg-slate-50 p-5 rounded-2xl font-black text-[10px] uppercase tracking-widest outline-none">${CATEGORIES.map(c => html`<option value=${c.name}>${c.name}</option>`)}</select>
                <input name="merchant" defaultValue=${editingItem?.merchant} placeholder="Merchant / Context" className="w-full bg-slate-50 p-5 rounded-2xl font-bold text-sm outline-none" />
                <input name="date" type="date" defaultValue=${getLocalYMD(editingItem ? parseDate(editingItem.date) : new Date())} className="w-full bg-slate-50 p-5 rounded-2xl font-black uppercase text-xs outline-none" required />
                <input type="hidden" name="type" value="expense" />
              </div>
              <button type="submit" className="w-full bg-slate-900 text-white p-6 rounded-[2rem] font-black uppercase text-[10px] tracking-widest shadow-2xl active-scale">Commit</button>
              <button type="button" onClick=${() => setShowAddModal(false)} className="w-full p-4 text-slate-300 font-black text-[10px] uppercase tracking-widest">Close</button>
            </form>
          </div>
        </div>
      `}

      ${confirmDelete && html`
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-6 animate-in">
          <div className="bg-white p-8 rounded-[3rem] w-full max-w-xs shadow-2xl text-center">
            <h3 className="text-2xl font-black mb-10 font-heading">Purge Record?</h3>
            <div className="flex gap-4">
              <button onClick=${() => setConfirmDelete(null)} className="flex-1 py-4 bg-slate-100 rounded-2xl font-black text-slate-400 text-[10px] uppercase tracking-widest active-scale">Cancel</button>
              <button onClick=${dbDelete} className="flex-1 py-4 bg-rose-500 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest active-scale">Delete</button>
            </div>
          </div>
        </div>
      `}

      ${toast && html`<div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[400] px-8 py-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] shadow-2xl uppercase tracking-widest flex items-center gap-3 animate-in"><${Icon} name="Check" size="16" /> ${toast.message}</div>`}
    </div>
  `;
}

// React Mounting
try {
  const mountNode = document.getElementById("root");
  if (mountNode) {
    ReactDOM.createRoot(mountNode).render(html`<${App} />`);
    console.log("Lavender App Mounted Successfully (Structured)");
  }
} catch (err) {
  console.error("Mount Error:", err);
}
