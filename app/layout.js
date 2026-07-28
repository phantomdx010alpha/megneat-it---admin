import './globals.css';

export const metadata = {
  title: 'Magneatit Admin',
  description: 'Registry, projects, clients, and license administration — single-operator tool.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
