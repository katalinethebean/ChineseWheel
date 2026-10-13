import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TeacherShell } from './components/TeacherShell'
import { Home } from './pages/Home'
import { Lesson } from './pages/Lesson'
import { Roster } from './pages/Roster'
import { Stats } from './pages/Stats'
import { Student } from './pages/Student'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/student" element={<Student />} />
        <Route path="/teacher" element={<TeacherShell wide><Lesson /></TeacherShell>} />
        <Route path="/teacher/roster" element={<TeacherShell><Roster /></TeacherShell>} />
        <Route path="/teacher/stats" element={<TeacherShell><Stats /></TeacherShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
