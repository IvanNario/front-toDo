import React from "react";
import { Navigate, useLocation } from "react-router-dom";


export default function ProtectedRoute({children} : {children: React.ReactNode}) {
    const token = localStorage.getItem("token");
    const location = useLocation();
    if (!token && location.pathname.startsWith("/join/")) {
        sessionStorage.setItem("pendingInvitePath", location.pathname);
    }
    return token ? <>{children}</> : <Navigate to="/" replace />;
}
