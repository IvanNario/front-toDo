import React from "react";
import ReactDom from "react-dom/client";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,  
} from "react-router-dom";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard.tsx";
import Profile from "./pages/Profile";
import TaskEdit from "./pages/TaskEdit";
import ProtectedRoute from "./routes/ProtectedRoute";

import "./index.css";

ReactDom.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
     <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="/tasks/:id/edit"
          element={
            <ProtectedRoute>
              <TaskEdit />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
