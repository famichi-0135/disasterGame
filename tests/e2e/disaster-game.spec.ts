import { expect, test } from "playwright/test";

const apiBase = "http://127.0.0.1:8788";

test("空き部屋一覧から参加し、相手の手札を隠したまま1ターン進行できる", async ({
    browser,
}) => {
    const darkContext = await browser.newContext();
    const governmentContext = await browser.newContext();

    const darkPage = await darkContext.newPage();
    const governmentPage = await governmentContext.newPage();

    await darkPage.goto("/");
    await expect(
        darkPage.getByRole("heading", { name: "対戦ルームに接続" }),
    ).toBeVisible();

    await darkPage.getByRole("button", { name: /新しいルームを作成/ }).click();

    await expect(darkPage.getByText("THREAT CONTROL")).toBeVisible();
    await expect(darkPage.getByText("TURN 1")).toBeVisible();
    await expect(
        darkPage
            .getByRole("region", { name: "日本政府" })
            .getByText("相手の手札は非公開です"),
    ).toBeVisible();
    await expect(darkPage.getByText("あなたが操作中です。")).toBeVisible();

    await governmentPage.goto("/");
    await governmentPage.getByRole("button", { name: /更新/ }).click();
    await expect(
        governmentPage.getByRole("button", { name: "参加" }).first(),
    ).toBeVisible();
    await governmentPage.getByRole("button", { name: "参加" }).first().click();

    await expect(governmentPage.getByText("GOVERNMENT RESPONSE")).toBeVisible();
    await expect(
        governmentPage
            .getByRole("region", { name: "闇の組織" })
            .getByText("相手の手札は非公開です"),
    ).toBeVisible();
    await expect(
        governmentPage.getByRole("region", { name: "日本政府" }),
    ).toContainText(/手札 \d+枚/);
    await expect(
        governmentPage.getByText("闇の組織が操作中です。"),
    ).toBeVisible();

    const darkArea = darkPage.getByRole("region", { name: "闇の組織" });
    await darkArea
        .locator('button[aria-label$="をプレイ"]:not([disabled])')
        .first()
        .click();

    await expect(
        governmentPage.getByText("あなたが操作中です。"),
    ).toBeVisible();
    await expect(governmentPage.getByText("現在の脅威")).toBeVisible();

    await governmentPage
        .getByRole("region", { name: "日本政府" })
        .getByRole("button", { name: /パスする/ })
        .click();

    await expect(darkPage.getByText("TURN 2")).toBeVisible();
    await expect(
        darkPage.getByRole("region", { name: "アクティビティログ" }),
    ).toContainText("判定");

    await darkPage.getByRole("button", { name: /すべてのTipsを見る/ }).click();
    await expect(
        darkPage.getByRole("dialog", { name: "防災Tips" }),
    ).toBeVisible();
    await darkPage.getByRole("button", { name: "防災Tipsを閉じる" }).click();
    await expect(
        darkPage.getByRole("dialog", { name: "防災Tips" }),
    ).toBeHidden();

    await darkPage.getByRole("button", { name: "ルームを退出" }).click();
    await governmentPage.getByRole("button", { name: "ルームを退出" }).click();

    await darkContext.close();
    await governmentContext.close();
});

test("自分のフェイズ中に手札を1枚基盤化できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /新しいルームを作成/ }).click();

    const darkArea = page.getByRole("region", { name: "闇の組織" });
    await expect(
        darkArea.getByText(/基盤化: 自分のフェイズ中に1枚まで/),
    ).toBeVisible();

    const firstChargeButton = darkArea
        .locator('button[aria-label$="を基盤化"]:not([disabled])')
        .first();
    await expect(firstChargeButton).toBeVisible();
    await firstChargeButton.click();

    await expect(darkArea).toContainText("基盤 1");
    await expect(
        darkArea.getByText("このターンは基盤化済みです。"),
    ).toBeVisible();
    await expect(
        darkArea.locator('button[aria-label$="を基盤化"]:not([disabled])'),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "ルームを退出" }).click();
});

test("不正なレーン指定のアクションはbackendで拒否される", async ({
    request,
}) => {
    const createdResponse = await request.post(`${apiBase}/api/matches`);
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()) as {
        matchId: string;
        playerToken: string;
    };

    try {
        const invalidActionResponse = await request.post(
            `${apiBase}/api/matches/${created.matchId}/actions`,
            {
                headers: {
                    "X-Player-Token": created.playerToken,
                },
                data: {
                    type: "play",
                    instanceId: "not-a-real-card",
                    lane: "invalid-lane",
                },
            },
        );

        expect(invalidActionResponse.status()).toBe(400);
        await expect(invalidActionResponse.text()).resolves.toContain(
            "アクションが不正です。",
        );
    } finally {
        await request.post(`${apiBase}/api/matches/${created.matchId}/leave`, {
            headers: {
                "X-Player-Token": created.playerToken,
            },
        });
    }
});
