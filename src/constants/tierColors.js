// Canonical TAD-VCI evidence-tier colour ramp.
//
// Single source of truth so a D5 (and every other tier) is the SAME colour in the
// tier track (TADVCITrack), the evidence card tier badge (TADVCIEvidence), and any
// future tier UI. Previously these two components diverged (blue-sequential ramp vs
// green/yellow/orange traffic-light) for the same D-tier, which was misleading.
//
// Adopted ramp: a single-hue BLUE→gray ORDINAL scale (D5 strongest recorded support →
// D1 weakest). Deliberately one hue so it reads as an ordered gradient, and it does
// NOT reuse any of the 5 categorical method-track hues (insulation orange /
// topdom purple / contact_contrast green / spectral teal / network red), so a tier
// tick is never confused with a method tick.
export const TIER_COLORS = Object.freeze({
  D5: '#1d4ed8', // strongest recorded support
  D4: '#3b82f6',
  D3: '#60a5fa',
  D2: '#93c5fd',
  D1: '#cbd5e1', // lowest recorded evidence tier
})

// High → low ordering, handy for legends.
export const TIER_ORDER = Object.freeze(['D5', 'D4', 'D3', 'D2', 'D1'])

export function tierColor(tier) {
  return TIER_COLORS[tier] || '#cbd5e1'
}
