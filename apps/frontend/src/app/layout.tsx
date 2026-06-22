import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-jp";
import "./globals.css";

export const metadata: Metadata = {
	title: "防災指令室 | 対戦カードゲーム",
	description: "災害への備えを学ぶ2人用の非対称対戦カードゲーム",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ja">
			<body style={{ fontFamily: '"Noto Sans JP Variable", "Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif' }}>{children}</body>
		</html>
	);
}
