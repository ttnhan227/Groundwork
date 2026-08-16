import type { Stats } from "./account";

export type AuthResult = {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    display_name: string;
    email: string;
    role: "user" | "admin";
    is_active: boolean;
    google_linked: boolean;
  };
};

export type AdminUser = AuthResult["user"] & Stats & { created_at: string };

export type SecuritySession = {
  id: string;
  created_at: string;
  expires_at: string;
};
