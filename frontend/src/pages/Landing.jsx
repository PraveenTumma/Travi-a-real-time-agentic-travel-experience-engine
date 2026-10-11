import React, { useState, useEffect, useRef } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import gsap from 'gsap';
import { Zap, Map, Shield, Cloud, MapPin, Sparkles, Star, Navigation, Camera, Luggage, Compass, Users, Home, Plane, Ticket, Coffee, TreePalm, ArrowRight, Code, Database, Braces } from 'lucide-react';
import Login from '../components/Login';

export default function Landing({ onLoginSuccess }) {
  const containerRef = useRef(null);
  const cardsRef = useRef([]);
  const doodlesRef = useRef([]);
  const uiElementsRef = useRef([]);

  const [hoveredCard, setHoveredCard] = useState(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, [-200, 200], [8, -8]);
  const rotateY = useTransform(x, [-200, 200], [-8, 8]);

  const handleMouseMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(event.clientX - centerX);
    y.set(event.clientY - centerY);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  const getBackgroundColor = () => {
    switch (hoveredCard) {
      case 'yellow': return 'var(--bg-yellow)';
      case 'blue': return 'var(--bg-blue)';
      case 'green': return 'var(--bg-green)';
      case 'red': return 'var(--bg-red)';
      default: return 'transparent'; 
    }
  };

  useEffect(() => {
    gsap.fromTo(containerRef.current.children, 
      { y: 60, opacity: 0, scale: 0.9, rotation: () => Math.random() * 10 - 5 },
      { y: 0, opacity: 1, scale: 1, rotation: 0, duration: 1.2, stagger: 0.15, ease: "elastic.out(1, 0.4)" }
    );

    doodlesRef.current.forEach((doodle, i) => {
      if(!doodle) return;
      
      const randomX = Math.random() * 40 - 20;
      const randomY = Math.random() * 40 - 20;
      const randomRot = Math.random() * 20 - 10;
      const duration = Math.random() * 4 + 3;

      if (doodle.classList.contains('drift')) {
        gsap.to(doodle, { x: randomX, y: randomY, rotation: randomRot, duration: duration, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
      if (doodle.classList.contains('pulse')) {
        gsap.to(doodle, { scale: 1.3, rotation: randomRot * 2, duration: duration, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
      if (doodle.classList.contains('wiggle')) {
        gsap.to(doodle, { rotation: randomRot * 3, x: randomX / 2, duration: duration / 2, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    });

    cardsRef.current.forEach(card => {
      if(!card) return;
      card.addEventListener('mouseenter', () => {
        gsap.to(card, { scale: 1.06, y: -10, rotation: Math.random() * 6 - 3, duration: 0.4, ease: "back.out(2)" });
      });
      card.addEventListener('mouseleave', () => {
        gsap.to(card, { scale: 1, y: 0, rotation: 0, duration: 0.4, ease: "back.out(2)" });
      });
    });

    uiElementsRef.current.forEach(el => {
      if(!el) return;
      el.addEventListener('mouseenter', () => {
        gsap.to(el, { x: 10, backgroundColor: '#f0f0f0', duration: 0.2, ease: "power2.out" });
        gsap.to(el.querySelector('svg'), { scale: 1.5, y: -5, duration: 0.3, ease: "back.out(3)" });
      });
      el.addEventListener('mouseleave', () => {
        gsap.to(el, { x: 0, backgroundColor: 'transparent', duration: 0.2, ease: "power2.out" });
        gsap.to(el.querySelector('svg'), { scale: 1, y: 0, duration: 0.3, ease: "back.out(3)" });
      });
    });
  }, []);

  const promptLogin = () => {
    alert("Time to plan! Please sign in to access your Doodle Journal.");
  };

  // The 4 tech stacks for the carousel
  const techStack = [
    { name: "React", icon: <Braces size={32} color="var(--marker-blue)" /> },
    { name: "Firebase", icon: <Database size={32} color="var(--marker-yellow)" /> },
    { name: "Vite", icon: <Zap size={32} color="var(--marker-blue)" /> },
    { name: "Claude Sonnet 5.5", icon: <Sparkles size={32} color="var(--marker-red)" /> },
    { name: "Google Maps", icon: <MapPin size={32} color="var(--marker-green)" /> },
    { name: "Live Weather", icon: <Cloud size={32} color="var(--marker-blue)" /> }
  ];

  return (
    <>
      <div style={{
        position: 'fixed',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: getBackgroundColor(),
        transition: 'background-color 0.4s ease',
        zIndex: -2,
        pointerEvents: 'none'
      }} />

      <main style={{ paddingBottom: '6rem', position: 'relative' }} ref={containerRef}>
        
        {/* STORYTELLING SCENERY (Spanning Full Height of Document, overflow hidden to prevent scrollbars) */}
        <div style={{ position: 'absolute', top: 0, left: 'calc(50% - 50vw)', width: '100vw', height: '100%', minHeight: '2000px', zIndex: -1, pointerEvents: 'none', overflow: 'hidden' }}>
          
          <svg style={{ position: 'absolute', width: '100vw', height: '100%', minHeight: '2000px' }}>
            <path d="M -200 400 Q 300 -100, 700 200 T 1400 600 T 200 1200 T 1000 1800" fill="transparent" stroke="var(--marker-blue)" strokeWidth="3" strokeDasharray="12 12" opacity={0.6} />
            
            <path d="M -50 500 Q 100 350, 250 500 T 500 500" fill="transparent" stroke="var(--ink-black)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />
            <path d="M 50 500 Q 200 300, 350 500" fill="transparent" stroke="var(--ink-black)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity={0.3} />
            
            <circle cx="85%" cy="150" r="40" fill="transparent" stroke="var(--marker-yellow)" strokeWidth="4" />
            <path d="M 85% 90 L 85% 60 M 85% 210 L 85% 240 M 75% 150 L 70% 150 M 95% 150 L 100% 150 M 78% 108 L 73% 78 M 92% 192 L 97% 222 M 92% 108 L 97% 78 M 78% 192 L 73% 222" stroke="var(--marker-yellow)" strokeWidth="4" strokeLinecap="round" />
          </svg>

          {/* Plane following the SVG path */}
          <div className="plane-follower">
            <Plane size={32} color="var(--marker-red)" fill="var(--marker-red)" style={{ transform: 'rotate(45deg)' }} />
          </div>

          <div className="wiggle" style={{ position: 'absolute', top: '380px', left: '10vw' }}>
            <Home size={40} color="var(--ink-black)" fill="var(--paper-white)" strokeWidth={1.5} />
            <div className="cartoon-font" style={{ position: 'absolute', top: '-25px', left: '20px', color: 'var(--text-secondary)' }}>Zzz...</div>
          </div>
          
          <div className="drift" style={{ position: 'absolute', top: '800px', left: '80vw' }}>
            <MapPin size={48} color="var(--marker-red)" fill="var(--paper-white)" strokeWidth={1.5} />
            <div className="cartoon-font" style={{ position: 'absolute', top: '-30px', left: '-20px', color: 'var(--marker-red)', fontSize: '1.5rem', whiteSpace: 'nowrap', transform: 'rotate(-5deg)' }}>Pit Stop!</div>
          </div>

          <div className="pulse" style={{ position: 'absolute', top: '1500px', left: '10vw' }}>
            <MapPin size={60} color="var(--marker-green)" fill="var(--paper-white)" strokeWidth={2} />
            <div className="cartoon-font" style={{ position: 'absolute', top: '-35px', left: '-10px', color: 'var(--marker-green)', fontSize: '2rem', whiteSpace: 'nowrap', transform: 'rotate(5deg)' }}>Final Destination!</div>
          </div>

          {/* EXTENDED WIDTH DOODLES - USING vw for perfect edge placement */}
          
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '5%', left: '3vw', opacity: 0.4, transform: 'rotate(-15deg)' }}>
            <Camera size={60} color="var(--marker-blue)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="pulse" style={{ position: 'absolute', top: '10%', right: '5vw', opacity: 0.5 }}>
            <Star size={30} color="var(--marker-yellow)" fill="var(--marker-yellow)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '20%', left: '15vw', opacity: 0.3, transform: 'rotate(-25deg)' }}>
            <Ticket size={45} color="var(--marker-red)" />
          </div>

          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '650px', left: '5vw', opacity: 0.4, transform: 'rotate(20deg)' }}>
            <Compass size={85} color="var(--ink-black)" strokeWidth={1} />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="pulse" style={{ position: 'absolute', top: '700px', right: '4vw', opacity: 0.4 }}>
            <Star size={40} color="var(--marker-red)" fill="var(--marker-red)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="wiggle" style={{ position: 'absolute', top: '850px', left: '85vw', opacity: 0.4, transform: 'rotate(10deg)' }}>
            <Luggage size={70} color="var(--marker-green)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '900px', left: '2vw', opacity: 0.3, transform: 'rotate(-10deg)' }}>
            <Coffee size={60} color="var(--marker-blue)" />
          </div>

          <div ref={el => doodlesRef.current.push(el)} className="wiggle" style={{ position: 'absolute', top: '1300px', right: '5vw', opacity: 0.5, transform: 'rotate(15deg)' }}>
            <TreePalm size={80} color="var(--marker-green)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '1400px', left: '8vw', opacity: 0.5, transform: 'rotate(-20deg)' }}>
            <Camera size={55} color="var(--marker-yellow)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="pulse" style={{ position: 'absolute', top: '1600px', right: '15vw', opacity: 0.3 }}>
            <Star size={25} color="var(--marker-blue)" fill="var(--marker-blue)" />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '1500px', right: '2vw', opacity: 0.4, transform: 'rotate(20deg)' }}>
            <Ticket size={70} color="var(--ink-black)" />
          </div>

          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '400px', left: '2vw', opacity: 0.2, transform: 'rotate(5deg)' }}>
            <Cloud size={120} color="var(--marker-blue)" fill="var(--paper-white)" strokeWidth={1} />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '1000px', right: '2vw', opacity: 0.2, transform: 'rotate(-5deg)' }}>
            <Cloud size={150} color="var(--marker-blue)" fill="var(--paper-white)" strokeWidth={1} />
          </div>
          <div ref={el => doodlesRef.current.push(el)} className="drift" style={{ position: 'absolute', top: '1800px', left: '10vw', opacity: 0.2, transform: 'rotate(8deg)' }}>
            <Cloud size={100} color="var(--marker-blue)" fill="var(--paper-white)" strokeWidth={1} />
          </div>

          <div className="cartoon-font drift" style={{ position: 'absolute', top: '200px', left: '8vw', fontSize: '2rem', color: 'var(--text-secondary)', transform: 'rotate(-15deg)' }}>
            Pack your bags!
          </div>
          <div className="cartoon-font drift" style={{ position: 'absolute', top: '600px', right: '8vw', fontSize: '2.5rem', color: 'var(--marker-blue)', transform: 'rotate(10deg)' }}>
            Let's go! <ArrowRight size={24} style={{display: 'inline', verticalAlign: 'middle'}}/>
          </div>
          <div className="cartoon-font wiggle" style={{ position: 'absolute', top: '1200px', left: '12vw', fontSize: '2.2rem', color: 'var(--marker-green)', transform: 'rotate(-5deg)' }}>
            Adventure awaits!
          </div>
          <div className="cartoon-font drift" style={{ position: 'absolute', top: '1700px', right: '10vw', fontSize: '2.2rem', color: 'var(--marker-red)', transform: 'rotate(8deg)' }}>
            Best trip ever!
          </div>
        </div>

        {/* 1. Hero Section */}
        <section style={{ 
          minHeight: '60vh', 
          display: 'flex', 
          flexDirection: 'column', 
          justifyContent: 'center', 
          alignItems: 'center',
          textAlign: 'center',
          paddingTop: '6rem',
          paddingBottom: '2rem',
          position: 'relative',
          zIndex: 10
        }}>
          
          <motion.div 
            whileHover={{ scale: 1.1, rotate: 5 }}
            whileTap={{ scale: 0.9 }}
            style={{ 
              background: 'var(--marker-yellow)', 
              border: 'var(--border-thick)', 
              padding: '8px 16px', 
              borderRadius: '4px',
              color: 'var(--ink-black)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '4px 4px 0px var(--ink-black)',
              transform: 'rotate(-3deg)',
              marginBottom: '2rem',
              fontWeight: '800',
              cursor: 'pointer'
            }}
          >
            <Sparkles size={18} fill="var(--ink-black)"/>
            Weather-aware AI • Re-plans in seconds
          </motion.div>

          {/* Animated Arrows Pointing to Logo - Perfectly Anchored to the Text */}
          <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1.5rem' }}>
            
            {/* Top Left Arrow */}
            <div className="wiggle" style={{ position: 'absolute', top: '-40px', left: '-80px', transform: 'rotate(20deg)', pointerEvents: 'none' }}>
              <svg width="80" height="80" viewBox="0 0 100 100">
                <path d="M 10 10 Q 40 20, 80 80" fill="transparent" stroke="var(--marker-red)" strokeWidth="6" strokeLinecap="round" />
                <polygon points="70,85 85,85 80,70" fill="var(--marker-red)" />
              </svg>
            </div>

            {/* Top Right Arrow */}
            <div className="pulse" style={{ position: 'absolute', top: '-30px', right: '-80px', transform: 'rotate(-40deg)', pointerEvents: 'none' }}>
              <svg width="80" height="80" viewBox="0 0 100 100">
                <path d="M 90 10 Q 60 20, 20 80" fill="transparent" stroke="var(--marker-green)" strokeWidth="6" strokeLinecap="round" strokeDasharray="8 8" />
                <polygon points="15,70 15,85 30,85" fill="var(--marker-green)" />
              </svg>
            </div>

            {/* Bottom Left Arrow */}
            <div className="drift" style={{ position: 'absolute', bottom: '-40px', left: '-80px', transform: 'rotate(-20deg)', pointerEvents: 'none' }}>
              <svg width="80" height="80" viewBox="0 0 100 100">
                <path d="M 10 90 Q 50 80, 80 20" fill="transparent" stroke="var(--marker-blue)" strokeWidth="6" strokeLinecap="round" />
                <polygon points="70,15 85,15 80,30" fill="var(--marker-blue)" />
              </svg>
            </div>

            {/* Bottom Right Arrow */}
            <div className="wiggle" style={{ position: 'absolute', bottom: '-20px', right: '-80px', transform: 'rotate(10deg)', pointerEvents: 'none' }}>
              <svg width="80" height="80" viewBox="0 0 100 100">
                <path d="M 90 90 Q 60 80, 20 20" fill="transparent" stroke="var(--marker-yellow)" strokeWidth="6" strokeLinecap="round" />
                <polygon points="15,30 15,15 30,15" fill="var(--marker-yellow)" />
              </svg>
            </div>

            <h1 style={{ 
              fontSize: 'clamp(4rem, 10vw, 8rem)', 
              fontWeight: '800', 
              lineHeight: '1',
              color: 'var(--marker-red)',
              textShadow: '4px 4px 0px var(--ink-black)',
              WebkitTextStroke: '2px var(--ink-black)',
              margin: 0
            }}>
              Travi!
            </h1>
          </div>
          
          <p className="cartoon-font" style={{ 
            fontSize: '2.2rem', 
            color: 'var(--text-secondary)', 
            maxWidth: '600px', 
            margin: '0 auto 3rem auto',
            lineHeight: '1.4'
          }}>
            Where are we flying to next? ✈️<br/>
            Your fun, AI-powered travel journal.
          </p>
          
          <div>
            <Login onLoginSuccess={onLoginSuccess} />
          </div>
        </section>

        {/* 2. Interactive "Scrapbook" UI Demo */}
        <section style={{ padding: '4rem 0 2rem 0', display: 'flex', justifyContent: 'center', perspective: '1200px', zIndex: 10 }}>
          <motion.div 
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={promptLogin}
            style={{ 
              width: '100%',
              maxWidth: '900px',
              rotateX: rotateX,
              rotateY: rotateY,
              transformStyle: 'preserve-3d',
              cursor: 'pointer'
            }}
          >
            <div className="comic-box" style={{ width: '100%', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '-15px', left: '50%', transform: 'translateX(-50%) rotate(-2deg)', width: '100px', height: '30px', background: 'rgba(255,255,255,0.7)', border: '1px solid #ccc', boxShadow: '1px 1px 3px rgba(0,0,0,0.1)', zIndex: 10 }}></div>
              
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                <span className="cartoon-font" style={{ fontSize: '2rem', color: 'var(--marker-blue)' }}>My Awesome Trip 🌴</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '2rem' }}>
                <div style={{ border: '3px dashed var(--ink-black)', borderRadius: '12px', padding: '1rem', background: '#fff' }}>
                  <div style={{ height: '24px', width: '60%', background: 'var(--marker-yellow)', borderRadius: '4px', marginBottom: '1.5rem', border: '2px solid var(--ink-black)' }} />
                  
                  <div ref={el => uiElementsRef.current[0] = el} style={{ padding: '0.5rem', borderRadius: '8px', borderBottom: '2px solid #ddd', marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                    <MapPin size={24} color="var(--marker-red)" style={{marginRight: '12px'}} /> <span style={{ fontWeight: 800 }}>Day 1: Arrival</span>
                  </div>
                  <div ref={el => uiElementsRef.current[1] = el} style={{ padding: '0.5rem', borderRadius: '8px', borderBottom: '2px solid #ddd', marginBottom: '0.5rem', display: 'flex', alignItems: 'center' }}>
                    <MapPin size={24} color="var(--marker-blue)" style={{marginRight: '12px'}} /> <span style={{ fontWeight: 800 }}>Day 2: City Tour</span>
                  </div>
                  <div ref={el => uiElementsRef.current[2] = el} style={{ padding: '0.5rem', borderRadius: '8px', display: 'flex', alignItems: 'center' }}>
                    <MapPin size={24} color="var(--marker-green)" style={{marginRight: '12px'}} /> <span style={{ fontWeight: 800 }}>Day 3: Relax</span>
                  </div>
                </div>

                <div style={{ background: '#f0f0f0', border: '3px solid var(--ink-black)', borderRadius: '12px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
                   <Map size={80} color="var(--text-secondary)" opacity={0.3} />
                   <svg style={{ position: 'absolute', width: '100%', height: '100%' }}>
                      <motion.path 
                        d="M 50 150 Q 150 50, 250 150 T 450 100" 
                        fill="transparent" 
                        stroke="var(--marker-red)" 
                        strokeWidth="4" 
                        strokeDasharray="6 8"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 3, ease: "linear", repeat: Infinity }}
                      />
                   </svg>
                   <motion.div 
                      animate={{ y: [0, -10, 0] }} 
                      transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
                      style={{ position: 'absolute', top: '40%', left: '40%' }}
                   >
                      <Navigation size={32} color="var(--marker-blue)" fill="var(--marker-blue)" />
                   </motion.div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* 2.5 Infinite Tech Stack Carousel */}
        <section style={{ overflow: 'hidden', padding: '2rem 0', marginBottom: '2rem', display: 'flex', flexWrap: 'nowrap' }}>
          <motion.div
            animate={{ x: ['0%', '-33.333%'] }}
            transition={{
              repeat: Infinity,
              duration: 20,
              ease: "linear",
            }}
            style={{ display: 'flex', gap: '2rem', whiteSpace: 'nowrap', width: 'fit-content' }}
          >
            {/* Double the array for seamless infinite scroll */}
            {[...techStack, ...techStack, ...techStack].map((tech, index) => (
              <div 
                key={index} 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '12px 24px', 
                  background: 'var(--paper-white)', 
                  border: '3px solid var(--ink-black)', 
                  borderRadius: '50px',
                  boxShadow: '4px 4px 0px var(--ink-black)',
                  transform: `rotate(${index % 2 === 0 ? '-2deg' : '2deg'})`
                }}
              >
                {tech.icon}
                <span style={{ fontSize: '1.2rem', fontWeight: '800', fontFamily: 'Nunito, sans-serif' }}>{tech.name}</span>
              </div>
            ))}
          </motion.div>
        </section>

        {/* 3. 2x2 Feature Cards Grid */}
        <section style={{ paddingTop: '2rem', zIndex: 10, position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h2 style={{ fontSize: '3.5rem', marginBottom: '1rem', color: 'var(--ink-black)' }}>
              Superpowers Included!
            </h2>
          </div>

          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(2, 1fr)', 
            gap: '2rem',
            maxWidth: '1000px',
            margin: '0 auto'
          }}>
            <div 
              ref={el => cardsRef.current[0] = el} 
              onMouseEnter={() => setHoveredCard('yellow')}
              onMouseLeave={() => setHoveredCard(null)}
              className="comic-box comic-box-yellow" 
              style={{ display: 'flex', flexDirection: 'column', minHeight: '220px', transformOrigin: 'bottom center' }}
            >
              <Zap size={48} fill="var(--marker-yellow)" color="var(--ink-black)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Smart AI Magic</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.5', fontWeight: '800' }}>
                Tell it your crazy constraints (vegan, $50 budget, bad knees) and it builds a plan that actually works.
              </p>
            </div>

            <div 
              ref={el => cardsRef.current[1] = el} 
              onMouseEnter={() => setHoveredCard('blue')}
              onMouseLeave={() => setHoveredCard(null)}
              className="comic-box comic-box-blue" 
              style={{ display: 'flex', flexDirection: 'column', minHeight: '220px', transformOrigin: 'bottom center' }}
            >
              <Cloud size={48} fill="var(--marker-blue)" color="var(--ink-black)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Rain? No Problem!</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.5', fontWeight: '800' }}>
                Weather changes? We instantly swap your park picnic for a museum trip in real-time.
              </p>
            </div>

            <div 
              ref={el => cardsRef.current[2] = el} 
              onMouseEnter={() => setHoveredCard('green')}
              onMouseLeave={() => setHoveredCard(null)}
              className="comic-box comic-box-green" 
              style={{ display: 'flex', flexDirection: 'column', minHeight: '220px', transformOrigin: 'bottom center' }}
            >
              <Shield size={48} fill="var(--marker-green)" color="var(--ink-black)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Fort Knox Security</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.5', fontWeight: '800' }}>
                Your travel plans are safe with Firebase auth. No peeking allowed!
              </p>
            </div>

            <div 
              ref={el => cardsRef.current[3] = el} 
              onMouseEnter={() => setHoveredCard('red')}
              onMouseLeave={() => setHoveredCard(null)}
              className="comic-box comic-box-red" 
              style={{ display: 'flex', flexDirection: 'column', minHeight: '220px', transformOrigin: 'bottom center', borderColor: 'var(--marker-red)', boxShadow: '6px 6px 0px var(--marker-red)' }}
            >
              <Users size={48} fill="var(--marker-red)" color="var(--ink-black)" style={{ marginBottom: '1rem' }} />
              <h3 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>Collaborative Planning</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', lineHeight: '1.5', fontWeight: '800' }}>
                Invite friends, vote on activities, and sync the perfect itinerary together!
              </p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
