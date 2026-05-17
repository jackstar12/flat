import forms from "@tailwindcss/forms";
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17201b",
        moss: "#2f5d50",
        mint: "#dff3ea",
        coral: "#e66a4e",
        lemon: "#f6d264",
        cloud: "#f7f8f4",
        line: "#d7ded3",
      },
      boxShadow: {
        soft: "0 14px 40px rgba(23, 32, 27, 0.08)",
      },
    },
  },
  plugins: [forms],
} satisfies Config;
