type PortalAnnouncement = {
  id: string
  title: string
  content: string
  scope: string | null
  serviceId: string | null
  sortOrder: number | null
  createdAt: string | null
  updatedAt: string | null
}

type AnnouncementsResponse = {
  ok: true
  announcements: PortalAnnouncement[]
}

export default defineEventHandler(async (): Promise<AnnouncementsResponse> => {
  const config = useRuntimeConfig()

  if (!config.zrClientId || !config.zrClientSecret) {
    return emptyAnnouncements()
  }

  const portalUrl = buildPortalUrl(config.zrPortalUrl)
  if (!portalUrl) {
    return emptyAnnouncements()
  }

  const response: any = await $fetch<any>(portalUrl, {
    method: 'POST',
    body: {
      clientId: config.zrClientId,
      clientSecret: config.zrClientSecret
    },
    timeout: 5000
  }).catch(() => null)

  if (!response) {
    return emptyAnnouncements()
  }

  const announcements: PortalAnnouncement[] = extractAnnouncements(response)
    .map(normalizeAnnouncement)
    .filter((announcement): announcement is PortalAnnouncement => Boolean(announcement?.id))

  return {
    ok: true as const,
    announcements: sortAnnouncements(announcements)
  }
})

function emptyAnnouncements(): AnnouncementsResponse {
  return {
    ok: true as const,
    announcements: [] as PortalAnnouncement[]
  }
}

function buildPortalUrl(baseUrl: unknown) {
  try {
    return new URL('/api/service-auth/announcements', String(baseUrl || '')).toString()
  } catch {
    return ''
  }
}

function extractAnnouncements(response: any) {
  const candidates = [
    response?.announcements,
    response?.data?.announcements,
    response?.data?.items,
    response?.data,
    response?.items,
    response
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

function normalizeAnnouncement(source: any): PortalAnnouncement | null {
  if (!source || typeof source !== 'object') return null

  const id = readString(source.id, source.announcementId, source.uuid)
  if (!id) return null

  return {
    id,
    title: readString(source.title, source.name, source.heading) || '公告',
    content: readString(source.content, source.message, source.body, source.description),
    scope: readNullableString(source.scope, source.targetScope),
    serviceId: readNullableString(source.serviceId, source.service_id, source.service?.id),
    sortOrder: readNumber(source.sortOrder, source.sort_order, source.order, source.sort),
    createdAt: readNullableString(source.createdAt, source.created_at),
    updatedAt: readNullableString(source.updatedAt, source.updated_at)
  }
}

function sortAnnouncements(announcements: PortalAnnouncement[]) {
  return announcements
    .map((announcement, index) => ({ announcement, index }))
    .sort((a, b) => {
      const sortA = a.announcement.sortOrder ?? Number.POSITIVE_INFINITY
      const sortB = b.announcement.sortOrder ?? Number.POSITIVE_INFINITY
      if (sortA !== sortB) return sortA - sortB

      const updatedA = parseDateTime(a.announcement.updatedAt)
      const updatedB = parseDateTime(b.announcement.updatedAt)
      if (updatedA !== updatedB) return updatedB - updatedA

      return a.index - b.index
    })
    .map((entry) => entry.announcement)
}

function parseDateTime(value: string | null) {
  if (!value) return 0
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function readNullableString(...values: unknown[]) {
  const value = readString(...values)
  return value || null
}

function readString(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined) continue
    if (typeof value === 'string') {
      const normalized = value.trim()
      if (normalized) return normalized
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value)
    }
  }
  return ''
}

function readNumber(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  return null
}
