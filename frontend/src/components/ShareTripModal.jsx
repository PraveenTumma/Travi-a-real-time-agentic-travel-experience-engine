import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Share2, X, Check, Loader2, Users } from 'lucide-react';
import {
  subscribeToFriends,
  createSharedTrip,
} from '../services/firestoreService';

/**
 * ShareTripModal — lets the user pick friends from their list
 * and share the current itinerary with them.
 */
export default function ShareTripModal({ user, itinerary, destination, origin, originValue, startDate, endDate, onClose }) {
  const [friends, setFriends] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [sharing, setSharing] = useState(false);
  const [result, setResult] = useState({ text: '', type: '' }); // 'success' | 'error'

  // Real-time friends list
  useEffect(() => {
    if (!user?.email) return;
    const unsub = subscribeToFriends(user.email, setFriends);
    return () => unsub();
  }, [user?.email]);

  const toggleFriend = (friend) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(friend.uid)) {
        next.delete(friend.uid);
      } else {
        next.add(friend.uid);
      }
      return next;
    });
  };

  const handleShare = async () => {
    if (selected.size === 0) return;
    setSharing(true);
    setResult({ text: '', type: '' });

    try {
      const selectedFriends = friends.filter((f) => selected.has(f.uid));
      const friendUids = selectedFriends.map((f) => f.uid);
      const friendEmails = selectedFriends.map((f) => f.email);

      await createSharedTrip(
        user,
        {
          destination: destination || itinerary?.destination || '',
          origin: origin || itinerary?.origin || '',
          originValue: originValue || '',
          startDate: startDate || '',
          endDate: endDate || '',
          itinerary: itinerary,
        },
        friendUids,
        friendEmails
      );

      setResult({
        text: `Trip shared with ${selectedFriends.map((f) => f.displayName || f.email).join(', ')}! 🎉`,
        type: 'success',
      });
      setSelected(new Set());

      // Auto-close after success
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setResult({ text: err.message || 'Failed to share trip.', type: 'error' });
    } finally {
      setSharing(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', zIndex: 1000,
        display: 'flex', justifyContent: 'center', alignItems: 'center',
      }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0, rotate: -2 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        onClick={(e) => e.stopPropagation()}
        className="comic-box"
        style={{
          width: '90%', maxWidth: '480px', padding: '2rem',
          background: 'var(--paper-white)', position: 'relative',
          maxHeight: '80vh', overflow: 'auto',
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '12px', right: '12px',
            background: 'var(--marker-red)', border: '2px solid var(--ink-black)',
            borderRadius: '50%', width: '36px', height: '36px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', boxShadow: '2px 2px 0px var(--ink-black)',
          }}
        >
          <X size={18} color="white" />
        </button>

        <h2
          className="cartoon-font"
          style={{ margin: '0 0 0.5rem 0', fontSize: '2.2rem', color: 'var(--ink-black)' }}
        >
          ✈️ Share Trip
        </h2>
        <p
          className="cartoon-font"
          style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: '0 0 1.25rem 0' }}
        >
          Pick friends to share your <strong>{destination || 'trip'}</strong> plan with!
        </p>

        {/* Friends List */}
        {friends.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🫥</div>
            <p
              className="cartoon-font"
              style={{ color: 'var(--text-secondary)', fontSize: '1.2rem' }}
            >
              No friends yet! Add friends first to share trips.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
            {friends.map((friend) => {
              const isSelected = selected.has(friend.uid);
              return (
                <button
                  key={friend.uid}
                  type="button"
                  onClick={() => toggleFriend(friend)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '0.75rem', border: '2px solid var(--ink-black)',
                    borderRadius: '8px',
                    background: isSelected ? 'var(--marker-green)' : 'white',
                    color: isSelected ? 'white' : 'var(--ink-black)',
                    boxShadow: isSelected
                      ? '2px 2px 0px var(--ink-black)'
                      : '3px 3px 0px var(--ink-black)',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  {/* Avatar */}
                  {friend.photoURL ? (
                    <img
                      src={friend.photoURL}
                      alt=""
                      style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        border: '2px solid var(--ink-black)', objectFit: 'cover',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '40px', height: '40px', borderRadius: '50%',
                        border: '2px solid var(--ink-black)',
                        background: isSelected ? 'white' : 'var(--marker-blue)',
                        color: isSelected ? 'var(--marker-green)' : 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontWeight: 'bold', fontSize: '1.2rem',
                      }}
                    >
                      {(friend.displayName || friend.email)[0].toUpperCase()}
                    </div>
                  )}

                  {/* Name / Email */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 'bold', fontFamily: "'Nunito', sans-serif",
                        fontSize: '1rem', overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {friend.displayName}
                    </div>
                    <div
                      style={{
                        fontSize: '0.8rem',
                        fontFamily: "'Nunito', sans-serif",
                        opacity: 0.7,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {friend.email}
                    </div>
                  </div>

                  {/* Checkmark */}
                  <div
                    style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      border: `2px solid ${isSelected ? 'white' : 'var(--ink-black)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isSelected ? 'white' : 'transparent',
                      flexShrink: 0,
                    }}
                  >
                    {isSelected && <Check size={16} color="var(--marker-green)" strokeWidth={3} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Result message */}
        <AnimatePresence>
          {result.text && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                padding: '0.75rem', borderRadius: '8px', marginBottom: '0.75rem',
                border: '2px solid var(--ink-black)',
                background: result.type === 'success' ? 'var(--marker-green)' : 'var(--marker-red)',
                color: 'white', fontFamily: "'Nunito', sans-serif", fontWeight: 'bold',
                boxShadow: '2px 2px 0px var(--ink-black)',
              }}
            >
              {result.text}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Share Button */}
        {friends.length > 0 && (
          <button
            onClick={handleShare}
            disabled={sharing || selected.size === 0}
            style={{
              width: '100%', padding: '0.85rem', borderRadius: '8px',
              border: '2px solid var(--ink-black)',
              background: sharing || selected.size === 0 ? '#ddd' : 'var(--marker-blue)',
              color: sharing || selected.size === 0 ? '#aaa' : 'white',
              fontFamily: "'Nunito', sans-serif", fontWeight: 'bold', fontSize: '1.1rem',
              cursor: sharing || selected.size === 0 ? 'not-allowed' : 'pointer',
              boxShadow: sharing || selected.size === 0 ? 'none' : '3px 3px 0px var(--ink-black)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              transition: 'all 0.15s',
            }}
          >
            {sharing ? (
              <><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Sharing...</>
            ) : (
              <><Share2 size={20} /> Share with {selected.size} friend{selected.size !== 1 ? 's' : ''}</>
            )}
          </button>
        )}
      </motion.div>
    </div>
  );
}
