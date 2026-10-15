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
  claimed: boolean
  total_plus: number
  total_minus: number
}

export type LessonRow = {
  id: string
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

export type StudentState =
  | { valid: false }
  | {
      valid: true
      student_id: string
      student_name: string
      class_id: string
      class_name: string
      credits: number
      lesson_active: boolean
      question: null | {
        id: string
        status: 'open' | 'spun'
        weight: number
        min_weight: number
        is_candidate: boolean
        total_weight: number
        candidate_count: number
        winner_name: string | null
        is_me: boolean | null
        seconds_since_spin: number | null
      }
    }
