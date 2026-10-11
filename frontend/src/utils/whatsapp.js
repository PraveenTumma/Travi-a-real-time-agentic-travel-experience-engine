// Builds a WhatsApp-friendly text summary of an itinerary and opens the WhatsApp share sheet.
// User picks the group/contact(s) inside WhatsApp — no API keys or Meta approval needed.

const MAX_URL_TEXT = 3500; // keep encoded URL well within browser/WhatsApp limits

const buildMessage = (itinerary, fallbackDestination, detailed) => {
  const lines = [`✈️ *Trip to ${itinerary.destination || fallbackDestination}* — planned with Travi!`];
  if (itinerary.summary) lines.push(itinerary.summary);
  if (itinerary.weather_overview) lines.push(`🌤️ ${itinerary.weather_overview}`);

  (itinerary.itinerary || []).forEach((day) => {
    lines.push('', `📅 *Day ${day.day}${day.date ? ` (${day.date})` : ''}* — ${day.theme || ''}`);
    if (detailed) {
      (day.activities || []).forEach((act) => {
        lines.push(`• ${act.time ? `${act.time} ` : ''}${act.name}`);
      });
    }
  });

  if (itinerary.total_estimated_cost_usd) {
    lines.push('', `💰 Estimated total: $${itinerary.total_estimated_cost_usd}`);
  }
  return lines.join('\n');
};

export const shareItineraryOnWhatsApp = (itinerary, fallbackDestination = '') => {
  let text = buildMessage(itinerary, fallbackDestination, true);
  if (encodeURIComponent(text).length > MAX_URL_TEXT) {
    text = buildMessage(itinerary, fallbackDestination, false); // themes only for long trips
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
};
