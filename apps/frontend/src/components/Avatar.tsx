'use client'

const AVATAR_COLORS = [
  'bg-orange-400',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-rose-500',
  'bg-amber-500',
  'bg-teal-500',
  'bg-pink-500',
  'bg-indigo-500',
]

export function getAvatarColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function Avatar({
  name,
  ai = false,
  size = 'sm',
}: {
  name: string
  ai?: boolean
  size?: 'xs' | 'sm' | 'md'
}) {
  const sizeClass = size === 'md' ? 'h-8 w-8 text-sm' : size === 'xs' ? 'h-5 w-5 text-[9px]' : 'h-7 w-7 text-xs'
  const colorClass = ai ? 'bg-violet-600' : getAvatarColor(name)
  const label = getInitials(name)

  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${sizeClass} ${colorClass}`}
    >
      {label}
    </div>
  )
}
