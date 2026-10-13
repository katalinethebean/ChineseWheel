import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { TeacherShell } from './components/TeacherShell'
import { ClassRoster } from './pages/ClassRoster'
import { Classes } from './pages/Classes'
import { Join } from './pages/Join'
import { Lesson } from './pages/Lesson'
import { Stats } from './pages/Stats'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/join/:code" element={<Join />} />
        <Route path="/" element={<TeacherShell><Classes /></TeacherShell>} />
        <Route path="/class/:classId" element={<TeacherShell><ClassRoster /></TeacherShell>} />
        <Route path="/class/:classId/stats" element={<TeacherShell><Stats /></TeacherShell>} />
        <Route path="/class/:classId/lesson" element={<TeacherShell wide><Lesson /></TeacherShell>} />
        <Route path="*" element={<TeacherShell><p>页面不存在</p></TeacherShell>} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
