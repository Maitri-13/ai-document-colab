export type DocumentType = 'tech_design_doc' | 'product_spec' | 'security_review' | 'plan' | 'custom'
export type DocumentState = 'SETUP' | 'GENERATING' | 'IN_REVIEW' | 'APPROVED' | 'INTERRUPTED'
export type SectionState =
  | 'NOT_STARTED'
  | 'DRAFT'
  | 'OPEN'
  | 'QUEUED_FOR_REVISION'
  | 'REVISING'
  | 'APPROVED'
  | 'DRAFT_ERROR'
export type AuthorType = 'human' | 'ai_critic'
export type ResourceStatus = 'pending' | 'fetched' | 'failed' | 'skipped'

export interface Comment {
  id: string
  sectionId: string
  parentId: string | null
  authorType: AuthorType
  authorLabel: string
  body: string
  anchoredText: string | null
  replacementText: string | null
  resolved: boolean
  resolvedBy: string | null
  resolvedAt: string | null
  createdAt: string
  replies?: Comment[]
}

export interface SectionSnapshot {
  id: string
  sectionId: string
  content: string
  version: number
  label: string
  createdAt: string
}

export interface Section {
  id: string
  documentId: string
  title: string
  content: string | null
  state: SectionState
  version: number
  orderIndex: number
  approvedBy: string | null
  approvedAt: string | null
  createdAt: string
  updatedAt: string
  comments: Comment[]
}

export interface Resource {
  id: string
  documentId: string
  type: 'file' | 'url' | 'jira' | 'confluence'
  source: string
  content: string | null
  status: ResourceStatus
  error: string | null
  createdAt: string
}

export type ActivityType =
  | 'section_drafted'
  | 'section_revised'
  | 'section_edited'
  | 'comment_added'
  | 'section_restored'
  | 'document_restored'
  | 'title_changed'

export interface DocumentActivity {
  id: string
  documentId: string
  role: 'human' | 'ai'
  actorLabel: string
  type: ActivityType
  body: string
  sectionId: string | null
  snapshotId: string | null
  documentSnapshotId: string | null
  createdAt: string
}

export interface DocumentSnapshotSection {
  sectionId: string
  title: string
  content: string
  orderIndex: number
  state?: string
}

export interface DocumentSnapshotDetail {
  id: string
  documentId: string
  title: string
  label: string
  createdAt: string
  sections: DocumentSnapshotSection[]
}

export interface ChatMessage {
  id: string
  documentId: string
  role: 'human' | 'ai'
  body: string
  createdAt: string
}

export interface Document {
  id: string
  type: DocumentType
  title: string
  brief: string
  state: DocumentState
  shareToken: string
  createdAt: string
  updatedAt: string
  sections: Section[]
  resources: Resource[]
}
