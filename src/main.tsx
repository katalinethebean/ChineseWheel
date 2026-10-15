import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { TeacherShell } from './components/TeacherShell'
import { ClassList } from './pages/ClassList'
import { Home } from './pages/Home'
import { JoinClass } from './pages/JoinClass'
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
        <Route path="/student" element={<JoinClass />} />
        <Route path="/student/:code" element={<Student />} />
        <Route path="/teacher" element={<TeacherShell><ClassList /></TeacherShell>} />
        <Route path="/teacher/:classId" element={<TeacherShell fit><Lesson /></TeacherShell>} />
        <Route path="/teacher/:classId/roster" element={<TeacherShell><Roster /></TeacherShell>} />
        <Route path="/teacher/:classId/stats" element={<TeacherShell><Stats /></TeacherShell>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
