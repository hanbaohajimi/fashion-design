/**
 * 验证 Amux 是否真的使用了多个参考图片
 * 通过对比单图 vs 多图的生成结果来判断
 */

import { config } from "dotenv";

config();

const AMUX_BASE_URL = process.env.AMUX_BASE_URL || "https://api.amux.ai/v1";
const AMUX_API_KEY = process.env.AMUX_API_KEY;
const IMAGE_MODEL = process.env.AMUX_IMAGE_MODEL || "gpt-image-2";

// 三张明显不同特征的测试图片 URL（需要公网可访问）
const TEST_IMAGE_1 = "https://placehold.co/400x400/red/white?text=RED";
const TEST_IMAGE_2 = "https://placehold.co/400x400/blue/white?text=BLUE";
const TEST_IMAGE_3 = "https://placehold.co/400x400/green/white?text=GREEN";

async function testSingleImage() {
  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", "A beautiful abstract design");
  form.set("n", "1");
  form.set("size", "1024x1024");

  const response1 = await fetch(TEST_IMAGE_1);
  const blob1 = await response1.blob();
  form.set("image", blob1, "test1.png");

  const response = await fetch(`${AMUX_BASE_URL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AMUX_API_KEY}` },
    body: form,
  });

  const body = await response.json();
  console.log("单图测试响应:", JSON.stringify(body, null, 2));
  return body;
}

async function testMultipleImages() {
  const form = new FormData();
  form.set("model", IMAGE_MODEL);
  form.set("prompt", "A beautiful abstract design combining all reference colors");
  form.set("n", "1");
  form.set("size", "1024x1024");

  const response1 = await fetch(TEST_IMAGE_1);
  const blob1 = await response1.blob();
  const response2 = await fetch(TEST_IMAGE_2);
  const blob2 = await response2.blob();
  const response3 = await fetch(TEST_IMAGE_3);
  const blob3 = await response3.blob();

  form.append("image", blob1, "test1.png");
  form.append("image", blob2, "test2.png");
  form.append("image", blob3, "test3.png");

  const response = await fetch(`${AMUX_BASE_URL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${AMUX_API_KEY}` },
    body: form,
  });

  const body = await response.json();
  console.log("多图测试响应:", JSON.stringify(body, null, 2));
  return body;
}

async function main() {
  console.log("🔍 验证 Amux 是否真的使用多个参考图片\n");

  if (!AMUX_API_KEY) {
    console.error("❌ 缺少 AMUX_API_KEY");
    process.exit(1);
  }

  console.log("1️⃣ 测试单个红色参考图...");
  const single = await testSingleImage();
  console.log();

  console.log("2️⃣ 测试三张不同颜色参考图（红+蓝+绿）...");
  const multiple = await testMultipleImages();
  console.log();

  console.log("📊 结论:");
  console.log("如果两次生成的图片 URL 相同或非常相似，说明 Amux 可能忽略了额外的图片");
  console.log("如果多图测试失败或返回错误，说明 Amux 不支持多图");
  console.log("需要人工检查生成的图片内容来最终确认");
}

main().catch(console.error);
