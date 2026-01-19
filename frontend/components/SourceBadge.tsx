/**
 * SourceBadge Component
 * Displays source (pseudo user) information
 */
import { generateAvatarColor } from '../lib/avatar';

interface SourceBadgeProps {
  displayName: string;
  avatarSeed: string;
  onClick?: () => void;
  className?: string;
}

export function SourceBadge({ displayName, avatarSeed, onClick, className = '' }: SourceBadgeProps) {
  const avatarColor = generateAvatarColor(avatarSeed);

  const Component = onClick ? 'button' : 'div';

  return (
    <Component
      onClick={onClick}
      className={`flex items-center gap-2 ${onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${className}`}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
        style={{ backgroundColor: avatarColor }}
      >
        {displayName.charAt(0).toUpperCase()}
      </div>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {displayName}
      </span>
    </Component>
  );
}
