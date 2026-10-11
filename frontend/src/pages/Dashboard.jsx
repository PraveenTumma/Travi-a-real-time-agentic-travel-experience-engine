import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Bookmark, Trash2, Eye, Share2, MessageCircle, Ticket } from 'lucide-react';
import { saveTrip, subscribeToSavedTrips, deleteSavedTrip, subscribeToSharedTrips } from '../services/firestoreService';
import { shareItineraryOnWhatsApp } from '../utils/whatsapp';
import ItineraryMap from '../components/ItineraryMap';
import TripChatbot from '../components/TripChatbot';
import ShareTripModal from '../components/ShareTripModal';
import TicketBooking from '../components/TicketBooking';

const PREFERENCE_OPTIONS = [
  { id: 'street-food', label: '🍜 Street Food', value: 'street food' },
  { id: 'fine-dining', label: '🍽️ Fine Dining', value: 'fine dining' },
  { id: 'temples', label: '⛩️ Temples', value: 'temples' },
  { id: 'museums', label: '🏛️ Museums', value: 'museums' },
  { id: 'nature', label: '🌿 Nature', value: 'nature' },
  { id: 'shopping', label: '🛍️ Shopping', value: 'shopping' },
  { id: 'nightlife', label: '🌙 Nightlife', value: 'nightlife' },
  { id: 'adventure', label: '🧗 Adventure', value: 'adventure' },
  { id: 'history', label: '📜 History', value: 'history' },
  { id: 'art', label: '🎨 Art', value: 'art' },
];

const DISRUPTION_OPTIONS = [
  "Heavy rain expected tomorrow",
  "Main museum closed for renovation",
  "Flight delayed by 4 hours",
  "Local festival happening nearby",
  "Traveler feeling unwell — lighter schedule needed",
];

// FastAPI sends 422 `detail` as an array of objects; flatten any shape to readable text
const formatApiError = (detail, fallback) => {
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => {
      const field = Array.isArray(d?.loc) ? d.loc.filter((x) => x !== 'body').join(' → ') : '';
      const msg = d?.msg || (typeof d === 'string' ? d : '');
      return field ? `${field}: ${msg}` : msg;
    }).filter(Boolean).join('; ') || fallback;
  }
  return fallback;
};

const API_BASE = import.meta.env.VITE_API_BASE || window.location.origin;

export default function Dashboard({ user }) {
  const [activeTab, setActiveTab] = useState('basics'); // basics, vibe, fun, needs

  const [destination, setDestination] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budgetLevel, setBudgetLevel] = useState('moderate');
  const [travelerType, setTravelerType] = useState('solo');
  const [selectedPrefs, setSelectedPrefs] = useState([]);
  const [accessibility, setAccessibility] = useState(false);
  const [dietary, setDietary] = useState('none');
  const [maxWalking, setMaxWalking] = useState(10);

  const [itinerary, setItinerary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [replanLoading, setReplanLoading] = useState(false);
  const [savedTrips, setSavedTrips] = useState([]);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const [viewingSavedTrip, setViewingSavedTrip] = useState(null);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isBookingOpen, setIsBookingOpen] = useState(false);
  // Per-activity editing: { dayIdx, actIdx, mode: 'swap'|'regenerate', loading }
  const [activityEdit, setActivityEdit] = useState(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [changedActivity, setChangedActivity] = useState(null); // { key, note }

  // Carousel state
  const [activeDay, setActiveDay] = useState(0);
  const [slideDirection, setSlideDirection] = useState(0); // -1 left, 1 right
  const [mapsApiKey, setMapsApiKey] = useState('');

  const totalDays = itinerary?.itinerary?.length || 0;
  const currentDay = itinerary?.itinerary?.[activeDay] || null;

  const goToDay = useCallback((idx) => {
    if (!itinerary?.itinerary) return;
    const clamped = Math.max(0, Math.min(idx, itinerary.itinerary.length - 1));
    setSlideDirection(clamped > activeDay ? 1 : -1);
    setActiveDay(clamped);
  }, [itinerary, activeDay]);

  const goNext = useCallback(() => goToDay(activeDay + 1), [goToDay, activeDay]);
  const goPrev = useCallback(() => goToDay(activeDay - 1), [goToDay, activeDay]);

  // Keyboard navigation for carousel
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!itinerary?.itinerary) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); goNext(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [itinerary, goNext, goPrev]);

  // Reset activeDay when a NEW trip loads (not when a single activity is edited or locked in place)
  const tripKey = itinerary ? [itinerary.destination, itinerary.summary, itinerary.itinerary?.length].join('|') : '';
  useEffect(() => { setActiveDay(0); }, [tripKey]);

  // Fetch Maps API key
  useEffect(() => {
    fetch(`${API_BASE}/api/maps-key`)
      .then(r => r.json())
      .then(d => { if (d.key) setMapsApiKey(d.key); })
      .catch(() => {});
  }, []);

  // Subscribe to saved trips
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToSavedTrips(user.uid, setSavedTrips);
    return () => unsub();
  }, [user?.uid]);

  // Subscribe to shared trips (trips friends shared with me)
  const [sharedTrips, setSharedTrips] = useState([]);
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = subscribeToSharedTrips(user.uid, setSharedTrips);
    return () => unsub();
  }, [user?.uid]);

  if (!user) return <Navigate to="/" replace />;

  const togglePref = (value) => {
    setSelectedPrefs((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value]
    );
  };

  const handleGenerate = async () => {
    if (!destination || !startDate || !endDate) {
      setError('Please fill in destination and dates.');
      return;
    }
    setLoading(true);
    setError('');
    setItinerary(null);
    setChangedActivity(null);
    setActivityEdit(null);

    try {
      const res = await fetch(`${API_BASE}/api/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination,
          start_date: startDate,
          end_date: endDate,
          budget_level: budgetLevel,
          preferences: selectedPrefs,
          traveler_type: travelerType,
          constraints: {
            max_daily_walking_km: maxWalking,
            accessibility_needs: accessibility,
            dietary_restrictions: dietary,
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(formatApiError(errData.detail, `Server error: ${res.status}`));
      }
      const data = await res.json();
      setItinerary(data);
    } catch (err) {
      setError(err.message || 'Failed to generate itinerary.');
    } finally {
      setLoading(false);
    }
  };

  const tripContext = () => ({
    budget_level: budgetLevel,
    preferences: selectedPrefs,
    traveler_type: travelerType,
    constraints: {
      max_daily_walking_km: maxWalking,
      accessibility_needs: accessibility,
      dietary_restrictions: dietary,
    },
  });

  const lockedActivityLabels = (trip) =>
    (trip?.itinerary || []).flatMap((d) =>
      (d.activities || []).filter((a) => a?.locked).map((a) => `Day ${d.day}: ${a.name}`)
    );

  const updateActivity = (dayIdx, actIdx, updater) => {
    setItinerary((prev) => {
      if (!prev?.itinerary) return prev;
      const days = prev.itinerary.map((d, di) => {
        if (di !== dayIdx) return d;
        const activities = (d.activities || []).map((a, ai) => (ai === actIdx ? updater(a) : a));
        return { ...d, activities };
      });
      return { ...prev, itinerary: days };
    });
  };

  const toggleLock = (dayIdx, actIdx) => {
    updateActivity(dayIdx, actIdx, (a) => ({ ...a, locked: !a.locked }));
  };

  const handleActivityEdit = async (dayIdx, actIdx, mode, instruction = '') => {
    const day = itinerary?.itinerary?.[dayIdx];
    const act = day?.activities?.[actIdx];
    if (!day || !act || act.locked) return;
    setActivityEdit({ dayIdx, actIdx, mode, loading: true });
    setError('');

    try {
      const res = await fetch(`${API_BASE}/api/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: itinerary.destination || destination,
          date: day.date || '',
          day_theme: day.theme || '',
          weather_note: day.weather_note || '',
          mode,
          instruction: instruction.trim(),
          activity: act,
          other_activities: (day.activities || []).filter((_, i) => i !== actIdx).map((a) => a.name),
          ...tripContext(),
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(formatApiError(errData.detail, `Activity update failed: ${res.status}`));
      }
      const data = await res.json();
      const next = data.activity || {};
      const oldCost = Number(act.estimated_cost_usd) || 0;
      const newCost = Number(next.estimated_cost_usd) || 0;
      const delta = newCost - oldCost;

      setItinerary((prev) => {
        if (!prev?.itinerary) return prev;
        const days = prev.itinerary.map((d, di) => {
          if (di !== dayIdx) return d;
          const activities = (d.activities || []).map((a, ai) => (ai === actIdx ? { ...next, locked: false } : a));
          const dayBudget = Number(d.daily_budget_estimate_usd);
          return {
            ...d,
            activities,
            ...(Number.isFinite(dayBudget) && dayBudget > 0
              ? { daily_budget_estimate_usd: Math.max(0, Math.round(dayBudget + delta)) }
              : {}),
          };
        });
        const total = Number(prev.total_estimated_cost_usd);
        return {
          ...prev,
          itinerary: days,
          ...(Number.isFinite(total) && total > 0
            ? { total_estimated_cost_usd: Math.max(0, Math.round(total + delta)) }
            : {}),
        };
      });
      setChangedActivity({
        key: `${dayIdx}-${actIdx}`,
        note: next.change_note || (mode === 'swap' ? `Swapped in ${next.name}` : 'Details refreshed'),
      });
      setEditInstruction('');
      setActivityEdit(null);
    } catch (err) {
      setError(err.message || 'Failed to update that activity.');
      setActivityEdit(null);
    }
  };

  const handleReplan = async (disruption) => {
    if (!itinerary) return;
    setReplanLoading(true);
    setError('');
    setChangedActivity(null);
    setActivityEdit(null);

    try {
      const res = await fetch(`${API_BASE}/api/replan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          original_destination: destination,
          start_date: startDate,
          end_date: endDate,
          budget_level: budgetLevel,
          preferences: selectedPrefs,
          traveler_type: travelerType,
          constraints: {
            max_daily_walking_km: maxWalking,
            accessibility_needs: accessibility,
            dietary_restrictions: dietary,
          },
          disruption,
          original_itinerary_summary: itinerary.summary || '',
          locked_activities: lockedActivityLabels(itinerary),
        }),
      });

      if (!res.ok) throw new Error(`Re-plan failed: ${res.status}`);
      const data = await res.json();
      setItinerary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setReplanLoading(false);
    }
  };

  const inputStyle = {
    padding: '0.75rem', 
    borderRadius: '8px',
    border: '2px solid var(--ink-black)', 
    background: 'var(--paper-white)',
    color: 'var(--ink-black)', 
    fontFamily: 'Nunito, sans-serif', 
    fontSize: '1rem', 
    width: '100%',
    boxSizing: 'border-box',
    boxShadow: '3px 3px 0px var(--ink-black)',
    outline: 'none'
  };
  const labelStyle = { 
    fontSize: '1.2rem', 
    color: 'var(--ink-black)', 
    marginBottom: '8px', 
    display: 'block',
    fontFamily: 'Caveat, cursive'
  };

  return (
    <main style={{ marginTop: '1.5rem', animation: 'fadeIn 0.5s ease-out' }} role="main">
      <a href="#itinerary-results" className="skip-link" style={{
        position: 'absolute', left: '-9999px', top: '0',
        background: 'var(--marker-blue)', color: '#fff', padding: '8px 16px',
        zIndex: 100, borderRadius: '0 0 8px 0', border: '2px solid var(--ink-black)'
      }}>Skip to results</a>

      <div className="comic-box" style={{ padding: '2rem', background: 'var(--paper-white)', marginBottom: '2rem' }}>
        <header style={{ marginBottom: '1.5rem', borderBottom: '2px dashed var(--ink-black)', paddingBottom: '1rem' }}>
          <h1 className="cartoon-font" style={{ fontSize: '3rem', margin: '0 0 0.5rem 0', color: 'var(--ink-black)' }}>
            Trip Planner
          </h1>
          <p className="cartoon-font" style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '1.5rem' }}>
            Configure your trip and let AI generate a weather-aware itinerary.
          </p>
        </header>

        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
          {/* Sidebar Form */}
          <aside aria-label="Trip configuration form">
            <div className="comic-box" style={{ padding: '1.5rem', textAlign: 'left', background: 'var(--paper-white)' }}>
              <h2 className="cartoon-font" style={{ marginTop: 0, marginBottom: '1.25rem', fontSize: '2rem', color: 'var(--ink-black)' }}>Trip Details</h2>
              <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                
                {/* Accordion 1: Basics */}
                <div style={{ border: '2px solid var(--ink-black)', borderRadius: '8px', overflow: 'hidden', boxShadow: '3px 3px 0px var(--ink-black)' }}>
                  <button 
                    type="button" 
                    onClick={() => setActiveTab(activeTab === 'basics' ? '' : 'basics')}
                    style={{ 
                      width: '100%', padding: '1rem', background: activeTab === 'basics' ? 'var(--marker-yellow)' : 'white', 
                      border: 'none', borderBottom: activeTab === 'basics' ? '2px solid var(--ink-black)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      fontFamily: 'Caveat, cursive', fontSize: '1.5rem', color: 'var(--ink-black)', fontWeight: 'bold'
                    }}
                  >
                    📍 The Basics
                    {activeTab === 'basics' ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
                  </button>
                  <AnimatePresence>
                    {activeTab === 'basics' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        style={{ background: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                      >
                        <div>
                          <label htmlFor="destination" style={labelStyle}>Destination *</label>
                          <input id="destination" type="text" placeholder="e.g., Tokyo, Japan" value={destination}
                            onChange={(e) => setDestination(e.target.value)} style={inputStyle} required aria-required="true" />
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="startDate" style={labelStyle}>Start Date *</label>
                            <input id="startDate" type="date" value={startDate}
                              onChange={(e) => setStartDate(e.target.value)} style={inputStyle} required aria-required="true" />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="endDate" style={labelStyle}>End Date *</label>
                            <input id="endDate" type="date" value={endDate}
                              onChange={(e) => setEndDate(e.target.value)} style={inputStyle} required aria-required="true" />
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Accordion 2: Vibe */}
                <div style={{ border: '2px solid var(--ink-black)', borderRadius: '8px', overflow: 'hidden', boxShadow: '3px 3px 0px var(--ink-black)' }}>
                  <button 
                    type="button" 
                    onClick={() => setActiveTab(activeTab === 'vibe' ? '' : 'vibe')}
                    style={{ 
                      width: '100%', padding: '1rem', background: activeTab === 'vibe' ? 'var(--marker-blue)' : 'white', 
                      border: 'none', borderBottom: activeTab === 'vibe' ? '2px solid var(--ink-black)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      fontFamily: 'Caveat, cursive', fontSize: '1.5rem', color: activeTab === 'vibe' ? 'white' : 'var(--ink-black)', fontWeight: 'bold'
                    }}
                  >
                    👥 The Vibe
                    {activeTab === 'vibe' ? <ChevronUp size={24} color="white" /> : <ChevronDown size={24} />}
                  </button>
                  <AnimatePresence>
                    {activeTab === 'vibe' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        style={{ background: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                      >
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="budget" style={labelStyle}>Budget</label>
                            <select id="budget" value={budgetLevel} onChange={(e) => setBudgetLevel(e.target.value)} style={inputStyle}>
                              <option value="budget">💰 Budget</option>
                              <option value="moderate">💳 Moderate</option>
                              <option value="luxury">💎 Luxury</option>
                            </select>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <label htmlFor="traveler" style={labelStyle}>Traveler</label>
                            <select id="traveler" value={travelerType} onChange={(e) => setTravelerType(e.target.value)} style={inputStyle}>
                              <option value="solo">🧑 Solo</option>
                              <option value="couple">👫 Couple</option>
                              <option value="family">👨‍👩‍👧 Family</option>
                              <option value="group">👥 Group</option>
                            </select>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Accordion 3: Fun Stuff */}
                <div style={{ border: '2px solid var(--ink-black)', borderRadius: '8px', overflow: 'hidden', boxShadow: '3px 3px 0px var(--ink-black)' }}>
                  <button 
                    type="button" 
                    onClick={() => setActiveTab(activeTab === 'fun' ? '' : 'fun')}
                    style={{ 
                      width: '100%', padding: '1rem', background: activeTab === 'fun' ? 'var(--marker-red)' : 'white', 
                      border: 'none', borderBottom: activeTab === 'fun' ? '2px solid var(--ink-black)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      fontFamily: 'Caveat, cursive', fontSize: '1.5rem', color: activeTab === 'fun' ? 'white' : 'var(--ink-black)', fontWeight: 'bold'
                    }}
                  >
                    ✨ Fun Stuff
                    {activeTab === 'fun' ? <ChevronUp size={24} color="white" /> : <ChevronDown size={24} />}
                  </button>
                  <AnimatePresence>
                    {activeTab === 'fun' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        style={{ background: 'white', padding: '1rem' }}
                      >
                        <label style={labelStyle}>Interests</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Travel interests">
                          {PREFERENCE_OPTIONS.map((pref) => (
                            <button key={pref.id} type="button" onClick={() => togglePref(pref.value)}
                              aria-pressed={selectedPrefs.includes(pref.value)}
                              style={{
                                padding: '6px 12px', borderRadius: '8px', fontSize: '1rem', fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                                border: '2px solid var(--ink-black)',
                                background: selectedPrefs.includes(pref.value) ? 'var(--marker-red)' : 'var(--paper-white)',
                                color: selectedPrefs.includes(pref.value) ? 'white' : 'var(--ink-black)',
                                boxShadow: selectedPrefs.includes(pref.value) ? '1px 1px 0px var(--ink-black)' : '3px 3px 0px var(--ink-black)',
                                transform: selectedPrefs.includes(pref.value) ? 'translate(2px, 2px)' : 'none',
                                cursor: 'pointer', transition: 'all 0.1s',
                              }}>
                              {pref.label}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Accordion 4: Special Needs */}
                <div style={{ border: '2px solid var(--ink-black)', borderRadius: '8px', overflow: 'hidden', boxShadow: '3px 3px 0px var(--ink-black)' }}>
                  <button 
                    type="button" 
                    onClick={() => setActiveTab(activeTab === 'needs' ? '' : 'needs')}
                    style={{ 
                      width: '100%', padding: '1rem', background: activeTab === 'needs' ? 'var(--marker-green)' : 'white', 
                      border: 'none', borderBottom: activeTab === 'needs' ? '2px solid var(--ink-black)' : 'none',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer',
                      fontFamily: 'Caveat, cursive', fontSize: '1.5rem', color: activeTab === 'needs' ? 'white' : 'var(--ink-black)', fontWeight: 'bold'
                    }}
                  >
                    ⚠️ Special Needs
                    {activeTab === 'needs' ? <ChevronUp size={24} color="white" /> : <ChevronDown size={24} />}
                  </button>
                  <AnimatePresence>
                    {activeTab === 'needs' && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }} 
                        animate={{ height: 'auto', opacity: 1 }} 
                        exit={{ height: 0, opacity: 0 }}
                        style={{ background: 'white', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                      >
                        <div>
                          <label htmlFor="maxWalking" style={labelStyle}>Max daily walking: {maxWalking} km</label>
                          <input id="maxWalking" type="range" min="1" max="30" value={maxWalking}
                            onChange={(e) => setMaxWalking(Number(e.target.value))}
                            style={{ width: '100%', accentColor: 'var(--marker-green)' }}
                            aria-valuemin={1} aria-valuemax={30} aria-valuenow={maxWalking} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <input id="accessibility" type="checkbox" checked={accessibility}
                            onChange={(e) => setAccessibility(e.target.checked)}
                            style={{ accentColor: 'var(--marker-green)', width: '20px', height: '20px', cursor: 'pointer' }} />
                          <label htmlFor="accessibility" style={{ ...labelStyle, margin: 0, cursor: 'pointer' }}>♿ Accessibility needed</label>
                        </div>
                        <div>
                          <label htmlFor="dietary" style={labelStyle}>Dietary restrictions</label>
                          <input id="dietary" type="text" placeholder="e.g., vegetarian, halal" value={dietary}
                            onChange={(e) => setDietary(e.target.value)} style={inputStyle} />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <hr style={{ border: '1px dashed var(--ink-black)', margin: '0.5rem 0', opacity: 0.3 }} />

                <button type="button" onClick={handleGenerate} disabled={loading}
                  aria-busy={loading}
                  className="comic-box"
                  style={{
                    background: loading ? 'var(--text-secondary)' : 'var(--marker-yellow)',
                    color: 'var(--ink-black)', border: '2px solid var(--ink-black)', padding: '1rem',
                    borderRadius: '8px', fontWeight: 'bold', fontSize: '1.2rem',
                    cursor: loading ? 'wait' : 'pointer', marginTop: '0.5rem',
                    transition: 'all 0.1s', fontFamily: 'Nunito, sans-serif',
                    boxShadow: '4px 4px 0px var(--ink-black)'
                  }}
                  onMouseOver={(e) => { if(!loading) { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px var(--ink-black)'; } }}
                  onMouseOut={(e) => { if(!loading) { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '4px 4px 0px var(--ink-black)'; } }}
                  onMouseDown={(e) => { if(!loading) { e.currentTarget.style.transform = 'translate(2px, 2px)'; e.currentTarget.style.boxShadow = '2px 2px 0px var(--ink-black)'; } }}
                >
                  {loading ? '⏳ Generating...' : '✨ Generate Itinerary'}
                </button>
              </form>
            </div>
          </aside>

          {/* Results Area */}
          <section id="itinerary-results" aria-live="polite" aria-label="Itinerary results">
            {error && (
              <div role="alert" style={{
                background: 'rgba(234,67,53,0.15)', border: '1px solid rgba(234,67,53,0.3)',
                padding: '1rem', borderRadius: '12px', marginBottom: '1rem', color: '#ff6b6b',
              }}>
                ⚠️ {error}
              </div>
            )}

            {loading && (
              <div className="comic-box" style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--paper-white)' }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem', animation: 'pulse 1.5s infinite' }}>🌍</div>
                <h3 className="cartoon-font" style={{ color: 'var(--ink-black)', fontSize: '2rem' }}>Planning your perfect trip...</h3>
                <p className="cartoon-font" style={{ color: 'var(--text-secondary)', fontSize: '1.5rem' }}>Analyzing weather, finding activities, crafting your itinerary</p>
              </div>
            )}

            {!itinerary && !loading && (
              <div className="comic-box" style={{ height: '100%', minHeight: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', background: 'var(--paper-white)' }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: 0.8 }}>🗺️</div>
                <h3 className="cartoon-font" style={{ color: 'var(--ink-black)', fontSize: '2rem' }}>Your Itinerary Awaits</h3>
                <p className="cartoon-font" style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '400px', fontSize: '1.5rem' }}>
                  Fill out the trip details and click "Generate" to see your AI-powered plan.
                </p>
              </div>
            )}

            {itinerary && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Summary */}
                <div className="comic-box" style={{ padding: '1.5rem', background: 'var(--paper-white)' }}>
                  {/* Action buttons — top right */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginBottom: '0.75rem' }}>
                    <button
                      onClick={async () => {
                        setSaveStatus('saving');
                        try {
                          await saveTrip(user, { destination, startDate, endDate, budgetLevel, travelerType, preferences: selectedPrefs }, itinerary);
                          setSaveStatus('saved');
                          setTimeout(() => setSaveStatus(''), 3000);
                        } catch (err) {
                          console.error('Save failed:', err);
                          setSaveStatus('');
                        }
                      }}
                      disabled={saveStatus === 'saving'}
                      style={{
                        padding: '0.4rem 0.75rem', borderRadius: '8px',
                        border: '2px solid var(--ink-black)',
                        background: saveStatus === 'saved' ? 'var(--marker-green)' : 'var(--marker-yellow)',
                        color: saveStatus === 'saved' ? 'white' : 'var(--ink-black)',
                        fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.85rem',
                        cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
                        boxShadow: '2px 2px 0px var(--ink-black)',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                    >
                      <Bookmark size={14} fill={saveStatus === 'saved' ? 'white' : 'none'} />
                      {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save'}
                    </button>
                    <button
                      onClick={() => setIsBookingOpen(true)}
                      style={{
                        padding: '0.4rem 0.75rem', borderRadius: '8px',
                        border: '2px solid var(--ink-black)',
                        background: 'var(--marker-green)',
                        color: 'white',
                        fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.85rem',
                        cursor: 'pointer',
                        boxShadow: '2px 2px 0px var(--ink-black)',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                    >
                      <Ticket size={14} />
                      Book Travel
                    </button>
                    {user && (
                      <button
                        onClick={() => setIsShareOpen(true)}
                        style={{
                          padding: '0.4rem 0.75rem', borderRadius: '8px',
                          border: '2px solid var(--ink-black)',
                          background: 'var(--marker-blue)',
                          color: 'white',
                          fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.85rem',
                          cursor: 'pointer',
                          boxShadow: '2px 2px 0px var(--ink-black)',
                          display: 'flex', alignItems: 'center', gap: '4px',
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s',
                        }}
                        onMouseOver={(e) => { e.currentTarget.style.transform = 'translate(-1px, -1px)'; e.currentTarget.style.boxShadow = '3px 3px 0px var(--ink-black)'; }}
                        onMouseOut={(e) => { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '2px 2px 0px var(--ink-black)'; }}
                      >
                        <Share2 size={14} />
                        Share
                      </button>
                    )}
                    <button
                      onClick={() => shareItineraryOnWhatsApp(itinerary, destination)}
                      aria-label="Share itinerary on WhatsApp"
                      style={{
                        padding: '0.4rem 0.75rem', borderRadius: '8px',
                        border: '2px solid var(--ink-black)',
                        background: '#25D366',
                        color: 'white',
                        fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.85rem',
                        cursor: 'pointer',
                        boxShadow: '2px 2px 0px var(--ink-black)',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s',
                      }}
                      onMouseOver={(e) => { e.currentTarget.style.transform = 'translate(-1px, -1px)'; e.currentTarget.style.boxShadow = '3px 3px 0px var(--ink-black)'; }}
                      onMouseOut={(e) => { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '2px 2px 0px var(--ink-black)'; }}
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </button>
                  </div>
                  {/* Trip summary — full width */}
                  <h2 className="cartoon-font" style={{ margin: '0 0 0.5rem 0', fontSize: '2rem', color: 'var(--ink-black)' }}>
                    📍 {itinerary.destination || destination}
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', margin: '0 0 0.75rem 0', fontSize: '1.1rem', fontWeight: 'bold' }}>{itinerary.summary}</p>
                  {itinerary.weather_overview && (
                    <p className="cartoon-font" style={{ color: 'var(--marker-blue)', fontSize: '1.5rem', margin: 0 }}>🌤️ {itinerary.weather_overview}</p>
                  )}
                  {itinerary.total_estimated_cost_usd && (
                    <p className="cartoon-font" style={{ color: 'var(--marker-green)', fontSize: '1.5rem', margin: '0.5rem 0 0 0', fontWeight: 'bold' }}>
                      💰 Estimated total: ${itinerary.total_estimated_cost_usd}
                    </p>
                  )}
                </div>

                {/* Day Card Carousel */}
                {totalDays > 0 && (
                  <div>
                    {/* Navigation Bar */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: '1rem', gap: '0.5rem',
                    }}>
                      <button
                        onClick={goPrev} disabled={activeDay === 0}
                        className="day-nav-btn"
                        aria-label="Previous day"
                        style={{
                          width: '48px', height: '48px', borderRadius: '50%',
                          border: '2px solid var(--ink-black)',
                          background: activeDay === 0 ? '#eee' : 'var(--marker-blue)',
                          color: activeDay === 0 ? '#aaa' : 'white',
                          cursor: activeDay === 0 ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: activeDay === 0 ? 'none' : '3px 3px 0px var(--ink-black)',
                          transition: 'all 0.15s', flexShrink: 0,
                        }}
                      >
                        <ChevronLeft size={24} />
                      </button>

                      {/* Day Dots */}
                      <div style={{
                        display: 'flex', gap: '6px', flexWrap: 'wrap',
                        justifyContent: 'center', flex: 1,
                      }}>
                        {itinerary.itinerary.map((_, idx) => (
                          <button
                            key={idx} onClick={() => goToDay(idx)}
                            aria-label={`Go to day ${idx + 1}`}
                            aria-current={idx === activeDay ? 'step' : undefined}
                            style={{
                              width: idx === activeDay ? '32px' : '12px',
                              height: '12px', borderRadius: '6px',
                              border: '2px solid var(--ink-black)',
                              background: idx === activeDay ? 'var(--marker-red)' : 'var(--paper-white)',
                              cursor: 'pointer', transition: 'all 0.2s',
                              padding: 0,
                              boxShadow: idx === activeDay ? '2px 2px 0px var(--ink-black)' : 'none',
                            }}
                          />
                        ))}
                      </div>

                      <button
                        onClick={goNext} disabled={activeDay >= totalDays - 1}
                        className="day-nav-btn"
                        aria-label="Next day"
                        style={{
                          width: '48px', height: '48px', borderRadius: '50%',
                          border: '2px solid var(--ink-black)',
                          background: activeDay >= totalDays - 1 ? '#eee' : 'var(--marker-blue)',
                          color: activeDay >= totalDays - 1 ? '#aaa' : 'white',
                          cursor: activeDay >= totalDays - 1 ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: activeDay >= totalDays - 1 ? 'none' : '3px 3px 0px var(--ink-black)',
                          transition: 'all 0.15s', flexShrink: 0,
                        }}
                      >
                        <ChevronRight size={24} />
                      </button>
                    </div>

                    {/* Keyboard hint */}
                    <div style={{
                      textAlign: 'center', marginBottom: '0.75rem',
                      fontSize: '0.85rem', color: 'var(--text-secondary)',
                      fontFamily: "'Nunito', sans-serif",
                    }}>
                      ← → Use arrow keys to navigate days
                    </div>

                    {/* Animated Card */}
                    <div style={{ position: 'relative', overflow: 'hidden', minHeight: '300px' }}>
                      <AnimatePresence mode="wait" initial={false}>
                        {currentDay && (
                          <motion.div
                            key={currentDay.day}
                            initial={{ x: slideDirection * 300, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -slideDirection * 300, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                          >
                            <div className="comic-box" style={{ padding: '1.5rem', background: 'var(--paper-white)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 className="cartoon-font" style={{ margin: 0, color: 'var(--marker-blue)', fontSize: '1.8rem' }}>
                                  Day {currentDay.day} — {currentDay.theme}
                                </h3>
                                <span className="cartoon-font" style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}>{currentDay.date}</span>
                              </div>
                              {currentDay.weather_note && (
                                <p className="cartoon-font" style={{ color: '#1a6b5a', fontSize: '1.2rem', margin: '0 0 1rem 0', background: '#e8f5f1', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1.5px solid #b2dfdb' }}>
                                  🌤️ {currentDay.weather_note}
                                </p>
                              )}

                              {/* Activities */}
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {(currentDay.activities || []).map((act, i) => {
                                  const editKey = `${activeDay}-${i}`;
                                  const isEditing = activityEdit && activityEdit.dayIdx === activeDay && activityEdit.actIdx === i;
                                  const isBusy = isEditing && activityEdit.loading;
                                  const anyBusy = !!activityEdit?.loading;
                                  const showInstruction = isEditing && !activityEdit.loading && activityEdit.mode === 'regenerate';
                                  const justChanged = changedActivity?.key === editKey;
                                  const locked = !!act.locked;
                                  const smallBtn = (bg, disabled) => ({
                                    padding: '4px 10px', borderRadius: '8px', fontSize: '0.9rem',
                                    border: '2px solid var(--ink-black)', background: bg,
                                    color: 'var(--ink-black)', fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                                    cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
                                    boxShadow: disabled ? 'none' : '2px 2px 0px var(--ink-black)',
                                  });
                                  return (
                                  <motion.div
                                    key={`${i}-${act.name}`}
                                    layout
                                    initial={justChanged ? { scale: 0.96, opacity: 0.4 } : false}
                                    animate={{ scale: 1, opacity: isBusy ? 0.55 : 1 }}
                                    transition={{ duration: 0.35 }}
                                    style={{
                                      display: 'flex', gap: '1rem', padding: '1rem',
                                      background: justChanged ? '#fff6cc' : (locked ? '#fffaf0' : 'white'),
                                      borderRadius: '8px',
                                      border: locked ? '2px solid var(--marker-yellow)' : '2px solid var(--ink-black)',
                                      boxShadow: locked ? '3px 3px 0px var(--marker-yellow)' : '3px 3px 0px var(--ink-black)',
                                      position: 'relative', transition: 'background 0.6s',
                                    }}
                                  >
                                    <div className="cartoon-font" style={{ minWidth: '60px', color: 'var(--marker-red)', fontSize: '1.2rem' }}>
                                      {act.time}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                      <div className="cartoon-font" style={{ fontSize: '1.5rem', marginBottom: '4px', color: 'var(--ink-black)' }}>
                                        {act.name}
                                        {act.indoor && <span style={{ marginLeft: '8px', fontSize: '1rem', color: 'var(--text-secondary)' }}>🏠 Indoor</span>}
                                        {locked && <span style={{ marginLeft: '8px', fontSize: '1rem', color: '#b8860b' }}>🔒 Locked</span>}
                                      </div>
                                      <div style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontFamily: 'Nunito, sans-serif' }}>{act.description}</div>
                                      {act.location && (
                                        <div style={{ color: 'var(--marker-blue)', fontSize: '0.85rem', fontFamily: 'Nunito, sans-serif', marginTop: '4px' }}>
                                          📍 {act.location}
                                        </div>
                                      )}
                                      <div className="cartoon-font" style={{ display: 'flex', gap: '12px', marginTop: '8px', fontSize: '1.2rem', color: 'var(--ink-black)' }}>
                                        <span>⏱️ {act.duration_hours}h</span>
                                        <span>💵 ${act.estimated_cost_usd}</span>
                                        <span style={{
                                          background: 'var(--marker-blue)', padding: '2px 8px',
                                          borderRadius: '8px', color: 'white', border: '2px solid var(--ink-black)'
                                        }}>{act.category}</span>
                                      </div>

                                      {justChanged && changedActivity?.note && (
                                        <div style={{ marginTop: '8px', fontSize: '0.9rem', fontFamily: 'Nunito, sans-serif', color: '#7a5c00', background: '#fff1b8', border: '1.5px dashed #e0b400', borderRadius: '8px', padding: '4px 8px' }}>
                                          ✨ {changedActivity.note}
                                        </div>
                                      )}

                                      {/* Per-activity actions: lock / swap / regenerate */}
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px', alignItems: 'center' }} role="group" aria-label={`Edit ${act.name}`}>
                                        <button type="button"
                                          onClick={() => toggleLock(activeDay, i)}
                                          disabled={anyBusy}
                                          title={locked ? 'Unlock so this can be changed or re-planned' : 'Keep this exactly as is, even during a re-plan'}
                                          style={smallBtn(locked ? 'var(--marker-yellow)' : 'var(--paper-white)', anyBusy)}
                                        >
                                          {locked ? '🔓 Unlock' : '🔒 Lock'}
                                        </button>
                                        <button type="button"
                                          onClick={() => handleActivityEdit(activeDay, i, 'swap')}
                                          disabled={locked || anyBusy}
                                          title="Replace with a different activity in this time slot"
                                          style={smallBtn('#d9ecff', locked || anyBusy)}
                                        >
                                          {isBusy && activityEdit.mode === 'swap' ? '🔁 Swapping…' : '🔁 Swap'}
                                        </button>
                                        <button type="button"
                                          onClick={() => {
                                            if (showInstruction) { setActivityEdit(null); setEditInstruction(''); }
                                            else { setEditInstruction(''); setActivityEdit({ dayIdx: activeDay, actIdx: i, mode: 'regenerate', loading: false }); }
                                          }}
                                          disabled={locked || anyBusy}
                                          title="Rewrite this activity, optionally with a request like cheaper or earlier"
                                          style={smallBtn(showInstruction ? 'var(--marker-green)' : '#e6fff5', locked || anyBusy)}
                                        >
                                          {isBusy && activityEdit.mode === 'regenerate' ? '✨ Regenerating…' : '✨ Regenerate'}
                                        </button>
                                      </div>

                                      {showInstruction && (
                                        <form
                                          onSubmit={(e) => { e.preventDefault(); handleActivityEdit(activeDay, i, 'regenerate', editInstruction); }}
                                          style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}
                                        >
                                          <input
                                            autoFocus
                                            value={editInstruction}
                                            onChange={(e) => setEditInstruction(e.target.value)}
                                            maxLength={300}
                                            placeholder="Optional: e.g. cheaper, earlier, kid-friendly, less walking"
                                            aria-label="What should change about this activity?"
                                            style={{ flex: 1, minWidth: '200px', padding: '6px 10px', borderRadius: '8px', border: '2px solid var(--ink-black)', fontFamily: 'Nunito, sans-serif', fontSize: '0.95rem', background: 'white', color: 'var(--ink-black)' }}
                                          />
                                          <button type="submit" style={smallBtn('var(--marker-green)', false)}>Go ✨</button>
                                          <button type="button" onClick={() => { setActivityEdit(null); setEditInstruction(''); }} style={smallBtn('var(--paper-white)', false)}>Cancel</button>
                                        </form>
                                      )}
                                    </div>
                                  </motion.div>
                                  );
                                })}
                              </div>

                              {/* Meals */}
                              {currentDay.meals && currentDay.meals.length > 0 && (
                                <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '2px dashed var(--ink-black)' }}>
                                  <div className="cartoon-font" style={{ fontSize: '1.5rem', color: 'var(--ink-black)', marginBottom: '0.5rem' }}>🍽️ Meals</div>
                                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                    {currentDay.meals.map((meal, i) => (
                                      <span key={i} style={{
                                        padding: '6px 12px', borderRadius: '8px', fontSize: '1rem', fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                                        background: 'var(--marker-yellow)', color: 'var(--ink-black)', border: '2px solid var(--ink-black)', boxShadow: '2px 2px 0px var(--ink-black)'
                                      }}>
                                        {meal.meal_type}: {meal.suggestion} (${meal.estimated_cost_usd})
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {currentDay.daily_budget_estimate_usd > 0 && (
                                <div className="cartoon-font" style={{ textAlign: 'right', marginTop: '1rem', fontSize: '1.5rem', color: 'var(--marker-green)' }}>
                                  Day budget: ${currentDay.daily_budget_estimate_usd}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Google Map */}
                    <div style={{ marginTop: '1rem' }}>
                      <ItineraryMap
                        day={currentDay}
                        mapsApiKey={mapsApiKey}
                        destination={itinerary.destination || destination}
                      />
                    </div>
                  </div>
                )}

                {/* Tips */}
                {(itinerary.packing_tips?.length > 0 || itinerary.local_tips?.length > 0) && (
                  <div className="comic-box" style={{ padding: '1.5rem', background: 'var(--paper-white)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                      {itinerary.packing_tips?.length > 0 && (
                        <div>
                          <h4 className="cartoon-font" style={{ margin: '0 0 0.5rem 0', color: 'var(--marker-yellow)', fontSize: '1.5rem' }}>🎒 Packing Tips</h4>
                          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--ink-black)', fontSize: '1rem', fontFamily: 'Nunito, sans-serif' }}>
                            {itinerary.packing_tips.map((tip, i) => <li key={i} style={{ marginBottom: '4px' }}>{tip}</li>)}
                          </ul>
                        </div>
                      )}
                      {itinerary.local_tips?.length > 0 && (
                        <div>
                          <h4 className="cartoon-font" style={{ margin: '0 0 0.5rem 0', color: 'var(--marker-green)', fontSize: '1.5rem' }}>📌 Local Tips</h4>
                          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--ink-black)', fontSize: '1rem', fontFamily: 'Nunito, sans-serif' }}>
                            {itinerary.local_tips.map((tip, i) => <li key={i} style={{ marginBottom: '4px' }}>{tip}</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Re-plan Section */}
                <div className="comic-box" style={{ padding: '1.5rem', background: 'var(--paper-white)' }}>
                  <h3 className="cartoon-font" style={{ margin: '0 0 0.75rem 0', color: 'var(--marker-red)', fontSize: '1.8rem' }}>🔄 Real-Time Re-Plan</h3>
                  <p className="cartoon-font" style={{ color: 'var(--text-secondary)', fontSize: '1.2rem', margin: '0 0 1rem 0' }}>
                    Simulate a disruption and see how the AI adapts your itinerary in real-time.
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Disruption scenarios">
                    {DISRUPTION_OPTIONS.map((d, i) => (
                      <button key={i} type="button" onClick={() => handleReplan(d)}
                        disabled={replanLoading}
                        style={{
                          padding: '8px 16px', borderRadius: '8px', fontSize: '1rem',
                          border: '2px solid var(--ink-black)',
                          background: 'var(--marker-red)', color: 'white',
                          cursor: replanLoading ? 'wait' : 'pointer', transition: 'all 0.1s',
                          fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                          boxShadow: '3px 3px 0px var(--ink-black)',
                        }}
                        onMouseOver={(e) => { if(!replanLoading) { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '5px 5px 0px var(--ink-black)'; } }}
                        onMouseOut={(e) => { if(!replanLoading) { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '3px 3px 0px var(--ink-black)'; } }}
                        onMouseDown={(e) => { if(!replanLoading) { e.currentTarget.style.transform = 'translate(2px, 2px)'; e.currentTarget.style.boxShadow = '1px 1px 0px var(--ink-black)'; } }}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  {replanLoading && <p className="cartoon-font" style={{ color: 'var(--marker-yellow)', marginTop: '1rem', fontSize: '1.2rem' }}>🔄 Re-planning...</p>}
                </div>

                {/* AI Travel Agent Chat */}
                <TripChatbot
                  itinerary={itinerary}
                  destination={itinerary.destination || destination}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      {/* My Saved Trips Section */}
      {savedTrips.length > 0 && (
        <div className="comic-box" style={{ padding: '2rem', background: 'var(--paper-white)', marginBottom: '2rem' }}>
          <h2 className="cartoon-font" style={{ margin: '0 0 1.5rem 0', fontSize: '2.5rem', color: 'var(--ink-black)' }}>
            📚 My Saved Trips
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {savedTrips.map((trip) => (
              <div key={trip.id} style={{
                border: '2px solid var(--ink-black)', borderRadius: '8px',
                padding: '1.25rem', background: 'white',
                boxShadow: '4px 4px 0px var(--ink-black)',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
                transition: 'transform 0.1s',
              }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px var(--ink-black)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '4px 4px 0px var(--ink-black)'; }}
              >
                <h3 className="cartoon-font" style={{ margin: 0, fontSize: '1.6rem', color: 'var(--marker-blue)' }}>
                  📍 {trip.destination || 'Unknown'}
                </h3>
                <p style={{ margin: 0, fontFamily: 'Nunito, sans-serif', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {trip.startDate} → {trip.endDate}
                </p>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem',
                    background: 'var(--marker-yellow)', border: '1.5px solid var(--ink-black)',
                    fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                  }}>{trip.budgetLevel || 'moderate'}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: '6px', fontSize: '0.8rem',
                    background: 'var(--marker-blue)', color: 'white', border: '1.5px solid var(--ink-black)',
                    fontFamily: 'Nunito, sans-serif', fontWeight: 'bold',
                  }}>{trip.travelerType || 'solo'}</span>
                </div>
                {trip.itinerary?.summary && (
                  <p style={{ margin: 0, fontFamily: 'Nunito, sans-serif', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {trip.itinerary.summary.substring(0, 100)}...
                  </p>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: 'auto', paddingTop: '0.5rem' }}>
                  <button onClick={() => {
                    setItinerary(trip.itinerary);
                    setDestination(trip.destination || '');
                    setStartDate(trip.startDate || '');
                    setEndDate(trip.endDate || '');
                    setBudgetLevel(trip.budgetLevel || 'moderate');
                    setTravelerType(trip.travelerType || 'solo');
                    setSelectedPrefs(trip.preferences || []);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }} style={{
                    flex: 1, padding: '0.5rem', borderRadius: '6px',
                    border: '2px solid var(--ink-black)',
                    background: 'var(--marker-green)', color: 'white',
                    fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.9rem',
                    cursor: 'pointer', boxShadow: '2px 2px 0px var(--ink-black)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                  }}>
                    <Eye size={16} /> View
                  </button>
                  <button onClick={async () => {
                    if (window.confirm('Delete this saved trip?')) {
                      await deleteSavedTrip(trip.id);
                    }
                  }} style={{
                    padding: '0.5rem 0.75rem', borderRadius: '6px',
                    border: '2px solid var(--ink-black)',
                    background: 'var(--marker-red)', color: 'white',
                    cursor: 'pointer', boxShadow: '2px 2px 0px var(--ink-black)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shared With You Section */}
      {sharedTrips.length > 0 && (
        <div className="comic-box" style={{ padding: '2rem', background: 'var(--paper-white)', marginBottom: '2rem' }}>
          <h2 className="cartoon-font" style={{ margin: '0 0 1.5rem 0', fontSize: '2.5rem', color: 'var(--ink-black)' }}>
            🤝 Shared With You
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {sharedTrips.filter(t => t.createdBy !== user?.uid).map((trip) => (
              <div key={trip.id} style={{
                border: '2px solid var(--ink-black)', borderRadius: '8px',
                padding: '1.25rem', background: 'white',
                boxShadow: '4px 4px 0px var(--ink-black)',
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
                transition: 'transform 0.1s',
              }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translate(-2px, -2px)'; e.currentTarget.style.boxShadow = '6px 6px 0px var(--ink-black)'; }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translate(0)'; e.currentTarget.style.boxShadow = '4px 4px 0px var(--ink-black)'; }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.25rem' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: 'var(--marker-blue)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--ink-black)', fontSize: '0.8rem', fontWeight: 'bold', flexShrink: 0,
                  }}>
                    {(trip.creatorName || '?')[0].toUpperCase()}
                  </div>
                  <span style={{ fontFamily: 'Nunito, sans-serif', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Shared by <strong>{trip.creatorName || 'a friend'}</strong>
                  </span>
                </div>
                <h3 className="cartoon-font" style={{ margin: 0, fontSize: '1.6rem', color: 'var(--marker-green)' }}>
                  ✈️ {trip.destination || 'Unknown'}
                </h3>
                <p style={{ margin: 0, fontFamily: 'Nunito, sans-serif', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  {trip.startDate} → {trip.endDate}
                </p>
                {trip.itinerary?.summary && (
                  <p style={{ margin: 0, fontFamily: 'Nunito, sans-serif', fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {trip.itinerary.summary.substring(0, 100)}...
                  </p>
                )}
                <button onClick={() => {
                  setItinerary(trip.itinerary);
                  setDestination(trip.destination || '');
                  setStartDate(trip.startDate || '');
                  setEndDate(trip.endDate || '');
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }} style={{
                  marginTop: 'auto', padding: '0.5rem', borderRadius: '6px',
                  border: '2px solid var(--ink-black)',
                  background: 'var(--marker-green)', color: 'white',
                  fontFamily: 'Nunito, sans-serif', fontWeight: 'bold', fontSize: '0.9rem',
                  cursor: 'pointer', boxShadow: '2px 2px 0px var(--ink-black)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px',
                }}>
                  <Eye size={16} /> View Plan
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        .skip-link:focus { left: 0 !important; }
        @media (max-width: 800px) {
          .comic-box > div[style*="grid-template-columns"] { grid-template-columns: 1fr !important; }
        }
      `}</style>

      {/* Share Trip Modal */}
      <AnimatePresence>
        {isBookingOpen && (
          <TicketBooking
            user={user}
            initial={{
              destination: itinerary?.destination || destination,
              date: startDate,
              returnDate: endDate,
            }}
            onClose={() => setIsBookingOpen(false)}
          />
        )}
        {isShareOpen && itinerary && user && (
          <ShareTripModal
            user={user}
            itinerary={itinerary}
            destination={itinerary.destination || destination}
            startDate={startDate}
            endDate={endDate}
            onClose={() => setIsShareOpen(false)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
