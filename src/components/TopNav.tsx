import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ChevronDown,
  Dumbbell,
  Gauge,
  Heart,
  LayoutDashboard,
  Menu,
  MoonStar,
  Settings,
  SunMedium,
  TrendingUp,
  Upload,
  X,
} from 'lucide-react'

export type NavTabKey = string

export interface NavSubItem {
  key: NavTabKey
  label: string
  icon?: ReactNode
  show: boolean
}

export interface NavGroup {
  key: string
  label: string
  icon?: ReactNode
  // If `tabs` has exactly 1 entry, the group renders as a flat tab.
  // If multiple, renders as a dropdown.
  tabs: NavSubItem[]
}

export interface TopNavProps {
  groups: NavGroup[]
  currentTab: NavTabKey
  onTabChange: (tab: NavTabKey) => void
  theme: 'light' | 'dark'
  onThemeToggle: () => void
  onReset: () => void
  onSettings?: () => void
}

const DEFAULT_GROUP_ICONS: Record<string, ReactNode> = {
  overview: <LayoutDashboard size={15} />,
  score: <Gauge size={15} />,
  health: <Heart size={15} />,
  fitness: <Dumbbell size={15} />,
  analysis: <TrendingUp size={15} />,
}

function isGroupActive(group: NavGroup, currentTab: NavTabKey): boolean {
  return group.tabs.some(t => t.key === currentTab)
}

function visibleSubItems(group: NavGroup): NavSubItem[] {
  return group.tabs.filter(t => t.show)
}

export default function TopNav({
  groups,
  currentTab,
  onTabChange,
  theme,
  onThemeToggle,
  onReset,
  onSettings,
}: TopNavProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navRef = useRef<HTMLDivElement | null>(null)

  // Filter to groups that have at least one visible sub-item
  const renderableGroups = groups.filter(g => visibleSubItems(g).length > 0)

  // Click-outside closes the dropdown
  useEffect(() => {
    if (openGroup === null) return
    const onDocClick = (e: MouseEvent) => {
      if (!navRef.current) return
      if (!navRef.current.contains(e.target as Node)) {
        setOpenGroup(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [openGroup])

  // Escape closes dropdown / mobile drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenGroup(null)
        setMobileOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const handleSelect = (key: NavTabKey) => {
    onTabChange(key)
    setOpenGroup(null)
    setMobileOpen(false)
  }

  const activeGroup =
    renderableGroups.find(g => isGroupActive(g, currentTab)) ?? null

  return (
    <>
      {/* Top bar */}
      <header
        ref={navRef}
        className="fixed top-0 left-0 right-0 z-[110] h-12 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 flex items-stretch"
      >
        {/* Desktop tabs */}
        <nav className="hidden md:flex items-stretch flex-1 min-w-0 px-2">
          {renderableGroups.map(group => {
            const subs = visibleSubItems(group)
            const active = isGroupActive(group, currentTab)
            const isFlat = subs.length === 1
            const groupIcon = group.icon ?? DEFAULT_GROUP_ICONS[group.key]
            const isOpen = openGroup === group.key

            if (isFlat) {
              const sub = subs[0]
              return (
                <button
                  key={group.key}
                  onClick={() => handleSelect(sub.key)}
                  className={`relative h-full flex items-center gap-1.5 px-3 text-[13px] transition-colors duration-150 ${
                    active
                      ? "text-green-400 before:content-[''] before:absolute before:left-2 before:right-2 before:bottom-0 before:h-[2px] before:bg-green-500 before:rounded-t"
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {groupIcon && (
                    <span className="shrink-0">{groupIcon}</span>
                  )}
                  <span className="whitespace-nowrap">{group.label}</span>
                </button>
              )
            }

            return (
              <div key={group.key} className="relative h-full flex items-stretch">
                <button
                  onClick={() => setOpenGroup(isOpen ? null : group.key)}
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  className={`relative h-full flex items-center gap-1.5 px-3 text-[13px] transition-colors duration-150 ${
                    active
                      ? "text-green-400 before:content-[''] before:absolute before:left-2 before:right-2 before:bottom-0 before:h-[2px] before:bg-green-500 before:rounded-t"
                      : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                >
                  {groupIcon && (
                    <span className="shrink-0">{groupIcon}</span>
                  )}
                  <span className="whitespace-nowrap">{group.label}</span>
                  <ChevronDown
                    size={13}
                    className={`shrink-0 transition-transform duration-150 ${
                      isOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isOpen && (
                  <div
                    role="menu"
                    className="absolute top-full left-2 mt-1 min-w-[200px] rounded-xl border border-zinc-800 bg-zinc-900 shadow-xl shadow-black/30 p-1 z-[120]"
                  >
                    {subs.map(sub => {
                      const subActive = sub.key === currentTab
                      return (
                        <button
                          key={sub.key}
                          role="menuitem"
                          onClick={() => handleSelect(sub.key)}
                          className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors duration-150 ${
                            subActive
                              ? 'bg-zinc-800/70 text-white'
                              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                          }`}
                        >
                          {sub.icon && (
                            <span
                              className={`shrink-0 ${
                                subActive ? 'text-green-400' : ''
                              }`}
                            >
                              {sub.icon}
                            </span>
                          )}
                          <span className="whitespace-nowrap">{sub.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Mobile: hamburger + active group label */}
        <div className="flex md:hidden items-center flex-1 min-w-0 px-2 gap-2">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors"
          >
            <Menu size={18} />
          </button>
          <div className="flex items-center gap-1.5 min-w-0">
            {activeGroup && (
              <>
                <span className="shrink-0 text-green-400">
                  {activeGroup.icon ?? DEFAULT_GROUP_ICONS[activeGroup.key]}
                </span>
                <span className="text-[13px] text-zinc-100 truncate">
                  {activeGroup.label}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Right-aligned actions */}
        <div className="flex items-center pr-2 gap-0.5 shrink-0">
          {onSettings && (
            <button
              onClick={onSettings}
              aria-label="Settings"
              title="Settings"
              className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors duration-150"
            >
              <Settings size={16} />
            </button>
          )}
          <button
            onClick={onThemeToggle}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors duration-150"
          >
            {theme === 'dark' ? <SunMedium size={16} /> : <MoonStar size={16} />}
          </button>
          <button
            onClick={onReset}
            aria-label="New import"
            title="New import"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50 transition-colors duration-150"
          >
            <Upload size={16} />
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-[130]">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute top-0 left-0 bottom-0 w-[280px] max-w-[85%] bg-zinc-950 border-r border-zinc-800 flex flex-col">
            <div className="flex items-center justify-between h-12 px-3 border-b border-zinc-800">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-zinc-500">
                Health
              </span>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {renderableGroups.map(group => {
                const subs = visibleSubItems(group)
                const isFlat = subs.length === 1
                const groupIcon = group.icon ?? DEFAULT_GROUP_ICONS[group.key]

                if (isFlat) {
                  const sub = subs[0]
                  const active = sub.key === currentTab
                  return (
                    <button
                      key={group.key}
                      onClick={() => handleSelect(sub.key)}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors duration-150 ${
                        active
                          ? 'bg-zinc-800/70 text-white'
                          : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                      }`}
                    >
                      <span
                        className={`shrink-0 ${
                          active ? 'text-green-400' : ''
                        }`}
                      >
                        {groupIcon}
                      </span>
                      <span>{group.label}</span>
                    </button>
                  )
                }

                return (
                  <div key={group.key} className="mt-2 first:mt-0">
                    <div className="flex items-center gap-2 px-2.5 pb-1 pt-2">
                      <span className="text-zinc-500">{groupIcon}</span>
                      <span className="text-[10px] font-medium tracking-wider uppercase text-zinc-600">
                        {group.label}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {subs.map(sub => {
                        const subActive = sub.key === currentTab
                        return (
                          <button
                            key={sub.key}
                            onClick={() => handleSelect(sub.key)}
                            className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors duration-150 ${
                              subActive
                                ? 'bg-zinc-800/70 text-white'
                                : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50'
                            }`}
                          >
                            {sub.icon && (
                              <span
                                className={`shrink-0 ${
                                  subActive ? 'text-green-400' : ''
                                }`}
                              >
                                {sub.icon}
                              </span>
                            )}
                            <span className="whitespace-nowrap">
                              {sub.label}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </nav>
          </div>
        </div>
      )}
    </>
  )
}
