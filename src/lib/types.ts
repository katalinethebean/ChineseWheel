export type ClassRow = {
  id: string
  name: string
  join_code: string
  created_at: string
}

export type StudentRow = {
  id: string
  name: string
  seq: number
  device_token_hash: string | null
  total_plus: number
  total_minus: number
}

export type LessonRow = {
  id: string
  class_id: string
  started_at: string
  settled_at: string | null
  exclude_picked: boolean
}

export type TeacherLessonState = {
  lesson: { id: string; started_at: string; settled_at: string | null; exclude_picked: boolean }
  students: { id: string; name: string; joined: boolean; present: boolean; picked: boolean }[]
  question: null | {
    id: string
    status: 'open' | 'spun'
    winner_id: string | null
    winner_name: string | null
    adjusted_count: number
  }
}

export type PublicClass = {
  class_id: string
  class_name: string
  students: { id: string; name: string; claimed: boolean }[]
}

export type StudentState =
  | { valid: false }
  | {
      valid: true
      student_id: string
      student_name: string
      class_id: string
      class_name: string
      lesson_active: boolean
      question: null | {
        id: string
        status: 'open' | 'spun'
        weight: number
        winner_name: string | null
        is_me: boolean | null
        seconds_since_spin: number | null
      }
    }
