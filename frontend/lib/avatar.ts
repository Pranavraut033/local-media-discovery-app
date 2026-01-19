/**
 * Avatar utility for generating consistent colors from seeds
 */

const AVATAR_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#FFA07A', // Light Salmon
  '#98D8C8', // Mint
  '#F7DC6F', // Yellow
  '#BB8FCE', // Purple
  '#85C1E2', // Light Blue
  '#F8B88B', // Peach
  '#AED6F1', // Powder Blue
  '#F5B7B1', // Light Pink
  '#82E0AA', // Light Green
];

export function generateAvatarColor(seed: string): string {
  // Use a simple hash function to convert seed to a color index
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }

  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

// Alias export for convenience
export const getAvatarColor = generateAvatarColor;
