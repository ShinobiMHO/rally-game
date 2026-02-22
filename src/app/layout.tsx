import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Rally Racer 3D',
  description: 'Top-down low-poly 3D rally racing game',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
