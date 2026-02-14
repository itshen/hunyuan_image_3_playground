#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HunyuanImage API 测试工具 - Web 服务

Copyright (c) 2025 Miyang Tech (Zhuhai Hengqin) Co., Ltd.
MIT License
"""

import sys
import json
import uuid
import asyncio
import aiosqlite
import time
import traceback
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, Any, List

from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, UploadFile, File
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

sys.path.insert(0, str(Path(__file__).parent.parent))
# api_client.py 在同目录下
import sys
sys.path.insert(0, str(Path(__file__).parent))
from api_client import HunyuanImageClient

# ============ 路径 & 常量 ============

SCRIPT_DIR = Path(__file__).parent
STATIC_DIR = SCRIPT_DIR / "static"
OUTPUT_DIR = SCRIPT_DIR / "output"
UPLOADS_DIR = SCRIPT_DIR / "uploads"
DB_PATH = SCRIPT_DIR / "data.db"

for d in (OUTPUT_DIR, STATIC_DIR, UPLOADS_DIR):
    d.mkdir(parents=True, exist_ok=True)

PORT = 8849
BJT = timezone(timedelta(hours=8))  # 北京时间

# 任务队列系统
active_jobs: Dict[str, Dict[str, Any]] = {}
task_queue: asyncio.PriorityQueue = None  # 在 lifespan 中初始化，使用优先级队列
queue_worker_task = None
queue_counter = 0  # 用于保证相同优先级时按入队顺序执行


def now_bjt() -> str:
    """返回北京时间 ISO 字符串"""
    return datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S")


# ============ 数据库 ============

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                prompt TEXT,
                seed INTEGER DEFAULT 42,
                image_size TEXT DEFAULT 'auto',
                width INTEGER DEFAULT 1024,
                height INTEGER DEFAULT 1024,
                steps INTEGER DEFAULT 50,
                api_url TEXT,
                status TEXT DEFAULT 'completed',
                error TEXT,
                info TEXT,
                duration_sec REAL DEFAULT 0,
                batch_count INTEGER DEFAULT 1,
                batch_total_sec REAL DEFAULT 0,
                parallel INTEGER DEFAULT 1,
                ref_images TEXT,
                created_at TEXT,
                sort_order INTEGER DEFAULT 0
            )
        """)
        await db.commit()
        
        # 检查是否需要添加字段（旧数据库升级）
        cursor = await db.execute("PRAGMA table_info(images)")
        columns = [row[1] for row in await cursor.fetchall()]
        if "ref_images" not in columns:
            await db.execute("ALTER TABLE images ADD COLUMN ref_images TEXT")
            await db.commit()
            print("✅ 数据库已升级：添加 ref_images 字段")
        if "sort_order" not in columns:
            await db.execute("ALTER TABLE images ADD COLUMN sort_order INTEGER DEFAULT 0")
            await db.commit()
            # 初始化 sort_order：按 created_at 倒序赋值
            await db.execute("""
                UPDATE images SET sort_order = (
                    SELECT COUNT(*) FROM images AS i2 
                    WHERE i2.created_at > images.created_at OR 
                          (i2.created_at = images.created_at AND i2.id > images.id)
                )
            """)
            await db.commit()
            print("✅ 数据库已升级：添加 sort_order 字段")
    print("✅ 数据库已初始化")


@asynccontextmanager
async def lifespan(app: FastAPI):
    global task_queue, queue_worker_task
    # 启动时初始化
    await init_db()
    task_queue = asyncio.PriorityQueue()  # 使用优先级队列
    queue_worker_task = asyncio.create_task(queue_worker())
    print("✅ 任务队列已启动")
    yield
    # 关闭时清理
    if queue_worker_task:
        queue_worker_task.cancel()
        try:
            await queue_worker_task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="HunyuanImage API 测试工具", lifespan=lifespan)

app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


async def get_next_sort_order():
    """获取下一个 sort_order 值（最小值 - 1，确保新图片排在最前面）"""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT MIN(sort_order) FROM images")
        row = await cursor.fetchone()
        min_order = row[0] if row[0] is not None else 0
        return min_order - 1


async def save_image_record(*, job_id, filename, prompt, seed, image_size, width, height,
                            steps, api_url, status="completed", error=None, info=None,
                            duration_sec=0, batch_count=1, batch_total_sec=0, parallel=True,
                            ref_images=None):
    # ref_images 是文件名列表，存储为 JSON 字符串
    ref_images_str = json.dumps(ref_images) if ref_images else None
    sort_order = await get_next_sort_order()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO images (job_id, filename, prompt, seed, image_size, width, height, steps, api_url, status, error, info, duration_sec, batch_count, batch_total_sec, parallel, ref_images, created_at, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (job_id, filename, prompt, seed, image_size, width, height, steps, api_url, status, error, info, duration_sec, batch_count, batch_total_sec, 1 if parallel else 0, ref_images_str, now_bjt(), sort_order))
        await db.commit()


async def update_batch_total(job_id: str, batch_total_sec: float):
    """批次结束后回填总耗时"""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE images SET batch_total_sec = ? WHERE job_id = ?",
            (batch_total_sec, job_id)
        )
        await db.commit()


async def get_history(limit: int = 100):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM images ORDER BY sort_order ASC LIMIT ?", (limit,))
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def delete_image_record(image_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT filename FROM images WHERE id = ?", (image_id,))
        row = await cursor.fetchone()
        if row and row[0]:
            fp = OUTPUT_DIR / row[0]
            if fp.exists():
                fp.unlink()
        await db.execute("DELETE FROM images WHERE id = ?", (image_id,))
        await db.commit()


async def clear_all_records():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM images")
        await db.commit()
    for f in OUTPUT_DIR.iterdir():
        if f.is_file() and f.suffix in ('.png', '.jpg', '.webp'):
            f.unlink()


# ============ 队列 Worker ============

async def queue_worker():
    """后台任务处理 worker，按优先级执行队列中的任务"""
    while True:
        try:
            # 从优先级队列获取任务，格式为 (priority, counter, job)
            priority, counter, job = await task_queue.get()
            job_id = job["job_id"]
            
            # 检查任务是否已被取消（从队列取出时可能已被标记取消）
            if job_id not in active_jobs:
                print(f"[{now_bjt()}] ⏭️ 跳过已取消的任务: {job_id}")
                task_queue.task_done()
                continue
            
            # 检查状态是否为 cancelled
            if active_jobs[job_id].get("status") == "cancelled":
                print(f"[{now_bjt()}] ⏭️ 跳过已取消的任务: {job_id}")
                active_jobs.pop(job_id, None)
                task_queue.task_done()
                continue
            
            # 标记开始执行
            active_jobs[job_id]["status"] = "generating"
            active_jobs[job_id]["started_ts"] = time.time()
            
            print(f"[{now_bjt()}] 🚀 开始执行任务: {job_id} (优先级: {priority})")
            
            try:
                await execute_generation(job)
            except Exception as e:
                print(f"[{now_bjt()}] ❌ 任务执行失败: {job_id}, {e}")
                traceback.print_exc()
                if job_id in active_jobs:
                    active_jobs[job_id]["status"] = "error"
                    active_jobs[job_id]["error"] = str(e)
            finally:
                task_queue.task_done()
                
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[{now_bjt()}] ❌ Worker 异常: {e}")
            traceback.print_exc()


async def execute_generation(job: dict):
    """执行单个生成任务"""
    job_id = job["job_id"]
    prompt = job["prompt"]
    api_url = job["api_url"]
    seed = job["seed"]
    image_size = job["image_size"]
    width = job["width"]
    height = job["height"]
    steps = job["steps"]
    count = job["count"]
    ref_images = job["ref_images"]
    parallel = job["parallel"]
    
    loop = asyncio.get_event_loop()
    batch_start = time.time()
    
    def do_generate_one(idx: int):
        """同步生成单张"""
        t0 = time.time()
        client = HunyuanImageClient(api_url)
        
        gradio_images = None
        if ref_images:
            gradio_images = []
            for fname in ref_images:
                if not fname:
                    continue
                lp = UPLOADS_DIR / fname
                if lp.exists():
                    gradio_images.append(client.upload_file(str(lp)))
        
        cur_seed = seed + idx if seed >= 0 else seed
        
        image, info = client.generate(
            prompt=prompt, images=gradio_images, seed=cur_seed,
            image_size=image_size, width=width, height=height,
            diff_infer_steps=steps,
        )
        duration = round(time.time() - t0, 1)
        return idx, image, info, duration, cur_seed
    
    async def run_one(idx: int):
        """执行单张生成，支持取消检查"""
        future = loop.run_in_executor(None, do_generate_one, idx)
        
        # 周期性检查是否被取消
        while True:
            # 每 2 秒检查一次取消状态
            done, pending = await asyncio.wait({future}, timeout=2.0)
            
            if done:
                # 任务完成
                return future.result()
            
            # 检查是否被取消
            if job_id not in active_jobs or active_jobs.get(job_id, {}).get("status") == "cancelled":
                # 任务已取消，尝试取消 future（虽然可能不会立即停止线程中的操作）
                future.cancel()
                raise asyncio.CancelledError(f"任务 {job_id} 已取消")
    
    async def save_result(idx, image, info, duration, cur_seed):
        """保存结果"""
        if image:
            ts = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f"{ts}_{job_id}_{idx}.png"
            image.save(OUTPUT_DIR / filename, format="PNG")
            
            info_str = str(info) if info else ""
            
            # 从实际图片获取尺寸
            actual_width, actual_height = image.size
            
            await save_image_record(
                job_id=job_id, filename=filename, prompt=prompt, seed=cur_seed,
                image_size=image_size, width=actual_width, height=actual_height,
                steps=steps, api_url=api_url, status="completed",
                info=info_str, duration_sec=duration,
                batch_count=count, batch_total_sec=0, parallel=parallel,
                ref_images=ref_images
            )
            
            # 更新任务进度
            if job_id in active_jobs:
                active_jobs[job_id]["completed"] = active_jobs[job_id].get("completed", 0) + 1
                active_jobs[job_id]["results"].append({
                    "filename": filename,
                    "url": f"/output/{filename}",
                    "duration": duration,
                    "seed": cur_seed,
                    "info": info_str,
                })
            
            print(f"[{now_bjt()}] ✅ 完成第 {idx+1}/{count} 张: {filename}")
            return True
        else:
            print(f"[{now_bjt()}] ❌ 第 {idx+1} 张未返回图像")
            return False
    
    def is_cancelled():
        """检查任务是否已被取消"""
        return job_id not in active_jobs or active_jobs.get(job_id, {}).get("status") == "cancelled"
    
    # 执行生成
    if parallel and count > 1:
        # 并发模式
        tasks = [asyncio.ensure_future(run_one(i)) for i in range(count)]
        for coro in asyncio.as_completed(tasks):
            # 检查是否已取消
            if is_cancelled():
                print(f"[{now_bjt()}] ⏹️ 任务已取消，停止处理: {job_id}")
                # 取消剩余的 task
                for t in tasks:
                    if not t.done():
                        t.cancel()
                return
            try:
                idx, image, info, duration, cur_seed = await coro
                await save_result(idx, image, info, duration, cur_seed)
            except asyncio.CancelledError:
                pass  # task 被取消，跳过
            except Exception as e:
                print(f"[{now_bjt()}] ❌ 生成失败: {e}")
                traceback.print_exc()
    else:
        # 顺序模式
        for i in range(count):
            # 检查是否已取消
            if is_cancelled():
                print(f"[{now_bjt()}] ⏹️ 任务已取消，停止处理: {job_id}")
                return
            try:
                idx, image, info, duration, cur_seed = await run_one(i)
                await save_result(idx, image, info, duration, cur_seed)
            except asyncio.CancelledError:
                print(f"[{now_bjt()}] ⏹️ 任务已取消，停止处理: {job_id}")
                return
            except Exception as e:
                print(f"[{now_bjt()}] ❌ 第 {i+1} 张生成失败: {e}")
                traceback.print_exc()
    
    # 批次结束
    batch_total = round(time.time() - batch_start, 1)
    
    # 如果任务已被取消，清理并退出
    if job_id not in active_jobs or active_jobs.get(job_id, {}).get("status") == "cancelled":
        active_jobs.pop(job_id, None)
        print(f"[{now_bjt()}] 🗑️ 已清理取消的任务: {job_id}")
        return
    
    await update_batch_total(job_id, batch_total)
    
    active_jobs[job_id]["status"] = "completed"
    active_jobs[job_id]["batch_total"] = batch_total
    
    print(f"[{now_bjt()}] 🎉 任务完成: {job_id}, 耗时 {batch_total}s")


# ============ 启动 ============



# ============ 页面 ============

@app.get("/", response_class=HTMLResponse)
async def index():
    p = STATIC_DIR / "index.html"
    return FileResponse(p) if p.exists() else HTMLResponse("<h1>缺少 static/index.html</h1>")


# ============ API ============

@app.get("/api/history")
async def api_history():
    history = await get_history()
    return JSONResponse({"success": True, "data": history})


@app.get("/api/jobs")
async def api_jobs():
    """获取当前进行中的任务列表（不含已完成的）"""
    jobs = [
        {
            "job_id": jid,
            "prompt": info.get("prompt", ""),
            "count": info.get("count", 1),
            "completed": info.get("completed", 0),
            "status": info.get("status", "pending"),
            "queued_ts": info.get("queued_ts"),
            "started_ts": info.get("started_ts"),  # None 表示还在排队
            "parallel": info.get("parallel", True),
            "results": info.get("results", []),
            "batch_total": info.get("batch_total"),
            "error": info.get("error"),
            "ratio": info.get("ratio", "auto"),
            "actual_width": info.get("actual_width"),
            "actual_height": info.get("actual_height"),
            "ref_images": info.get("ref_images", []),
        }
        for jid, info in active_jobs.items()
        if info.get("status") not in ("completed", "error")  # 只返回进行中的
    ]
    return JSONResponse({"success": True, "data": jobs, "queue_size": task_queue.qsize()})


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix or '.png'
    local_name = f"{uuid.uuid4().hex[:8]}{ext}"
    local_path = UPLOADS_DIR / local_name
    content = await file.read()
    with open(local_path, 'wb') as f:
        f.write(content)
    print(f"📤 图片已保存: {local_name} ({len(content)} bytes)")
    return JSONResponse({"success": True, "filename": local_name, "url": f"/uploads/{local_name}", "size": len(content)})


@app.post("/api/generate")
async def api_generate(request: Request):
    """提交生成任务到队列"""
    global queue_counter
    data = await request.json()

    api_url = data.get("api_url", "").strip()
    prompt = data.get("prompt", "").strip()
    seed = int(data.get("seed", 42))
    image_size = data.get("image_size", "auto")
    width = int(data.get("width", 1024))
    height = int(data.get("height", 1024))
    ratio = data.get("ratio", "auto")  # 比例，用于前端显示
    actual_width = int(data.get("actual_width", 1024))  # 实际宽度（未交换）
    actual_height = int(data.get("actual_height", 1024))  # 实际高度（未交换）
    steps = int(data.get("steps", 50))
    count = int(data.get("count", 1))
    ref_images: List[str] = data.get("ref_images", [])
    parallel = data.get("parallel", True)

    if not api_url:
        return JSONResponse({"success": False, "error": "请输入 API 地址"}, status_code=400)
    if not prompt:
        return JSONResponse({"success": False, "error": "请输入提示词"}, status_code=400)

    count = min(max(count, 1), 4)
    job_id = str(uuid.uuid4())[:8]
    queued_ts = time.time()
    
    # 计算队列位置
    queue_position = task_queue.qsize() + 1
    
    # 获取当前计数器值并递增
    current_counter = queue_counter
    queue_counter += 1

    # 注册任务（pending 状态，started_ts 为 None）
    active_jobs[job_id] = {
        "prompt": prompt,
        "count": count,
        "parallel": parallel,
        "status": "pending",
        "queued": now_bjt(),
        "queued_ts": queued_ts,
        "started_ts": None,  # 开始执行时更新
        "completed": 0,
        "results": [],
        "queue_position": queue_position,
        "priority": 1,  # 默认优先级为 1（普通任务）
        "counter": current_counter,  # 记录入队顺序
        "api_url": api_url,
        "seed": seed,
        "image_size": image_size,
        "width": width,
        "height": height,
        "ratio": ratio,  # 比例
        "actual_width": actual_width,  # 实际宽度
        "actual_height": actual_height,  # 实际高度
        "steps": steps,
        "ref_images": ref_images,
    }

    # 加入优先级队列：(priority, counter, job_data)
    # priority 越小优先级越高，counter 用于相同优先级时按入队顺序
    job_data = {
        "job_id": job_id,
        "api_url": api_url,
        "prompt": prompt,
        "seed": seed,
        "image_size": image_size,
        "width": width,
        "height": height,
        "steps": steps,
        "count": count,
        "ref_images": ref_images,
        "parallel": parallel,
    }
    await task_queue.put((1, current_counter, job_data))  # 默认优先级 1
    
    mode = "图生图" if ref_images else "文生图"
    mode_label = "并发" if parallel else "顺序"
    print(f"[{now_bjt()}] 📥 任务入队: {job_id} ({mode}, {count}张, {mode_label}), 队列位置: {queue_position}")

    return JSONResponse({
        "success": True,
        "job_id": job_id,
        "queue_position": queue_position,
        "message": f"任务已加入队列，位置 #{queue_position}"
    })


@app.get("/api/job/{job_id}")
async def api_job_status(job_id: str):
    """获取单个任务状态"""
    if job_id not in active_jobs:
        return JSONResponse({"success": False, "error": "任务不存在"}, status_code=404)
    
    job = active_jobs[job_id]
    return JSONResponse({
        "success": True,
        "data": {
            "job_id": job_id,
            "status": job.get("status"),
            "prompt": job.get("prompt"),
            "count": job.get("count"),
            "completed": job.get("completed", 0),
            "parallel": job.get("parallel"),
            "queued_ts": job.get("queued_ts"),
            "started_ts": job.get("started_ts"),
            "batch_total": job.get("batch_total"),
            "results": job.get("results", []),
            "error": job.get("error"),
        }
    })


@app.post("/api/job/{job_id}/ack")
async def api_job_ack(job_id: str):
    """确认任务完成，从 active_jobs 移除"""
    if job_id in active_jobs:
        active_jobs.pop(job_id, None)
    return JSONResponse({"success": True})


@app.delete("/api/job/{job_id}")
async def api_cancel_job(job_id: str):
    """取消排队中的任务（只能取消 pending 状态的）"""
    if job_id not in active_jobs:
        return JSONResponse({"success": False, "error": "任务不存在"}, status_code=404)
    
    job = active_jobs[job_id]
    if job.get("status") != "pending":
        return JSONResponse({"success": False, "error": "只能取消排队中的任务"}, status_code=400)
    
    # 从队列中移除该任务
    temp_queue = []
    found = False
    
    while not task_queue.empty():
        try:
            priority, counter, job_data = task_queue.get_nowait()
            if job_data["job_id"] != job_id:
                temp_queue.append((priority, counter, job_data))
            else:
                found = True
        except asyncio.QueueEmpty:
            break
    
    # 重新放回队列
    for item in temp_queue:
        await task_queue.put(item)
    
    # 标记为已取消
    active_jobs[job_id]["status"] = "cancelled"
    active_jobs.pop(job_id, None)
    print(f"[{now_bjt()}] ❌ 任务已取消: {job_id}")
    return JSONResponse({"success": True})


@app.post("/api/job/{job_id}/cancel")
async def api_cancel_generating(job_id: str):
    """取消正在生成的任务（标记为取消，让 worker 跳过）"""
    if job_id not in active_jobs:
        return JSONResponse({"success": False, "error": "任务不存在"}, status_code=404)
    
    # 标记为已取消，worker 检测到后会跳过
    # 注意：不立即删除，让 execute_generation 检测到取消后自行退出
    active_jobs[job_id]["status"] = "cancelled"
    print(f"[{now_bjt()}] ❌ 生成任务已取消: {job_id}")
    return JSONResponse({"success": True})


@app.post("/api/job/{job_id}/priority")
async def api_priority_job(job_id: str):
    """置顶排队中的任务（移到队列最前面）"""
    if job_id not in active_jobs:
        return JSONResponse({"success": False, "error": "任务不存在"}, status_code=404)
    
    job = active_jobs[job_id]
    if job.get("status") != "pending":
        return JSONResponse({"success": False, "error": "只能置顶排队中的任务"}, status_code=400)
    
    # 从队列中取出所有任务，找到目标任务并提升优先级
    temp_queue = []
    found = False
    
    # 取出所有任务
    while not task_queue.empty():
        try:
            priority, counter, job_data = task_queue.get_nowait()
            if job_data["job_id"] == job_id:
                # 找到目标任务，设置优先级为 0（最高）
                temp_queue.append((0, counter, job_data))
                found = True
                print(f"[{now_bjt()}] ⬆️ 任务已置顶: {job_id}")
            else:
                temp_queue.append((priority, counter, job_data))
        except asyncio.QueueEmpty:
            break
    
    # 重新放回队列
    for item in temp_queue:
        await task_queue.put(item)
    
    if found:
        # 更新任务状态
        active_jobs[job_id]["priority"] = 0
        active_jobs[job_id]["queued_ts"] = 0  # 前端显示用
        return JSONResponse({"success": True, "message": "任务已置顶"})
    else:
        return JSONResponse({"success": False, "error": "任务未在队列中找到"}, status_code=404)


@app.post("/api/reorder")
async def api_reorder(request: Request):
    """重新排序图片，接收完整的 id 顺序数组"""
    data = await request.json()
    order = data.get("order", [])  # [id1, id2, id3, ...]
    
    if not order:
        return JSONResponse({"success": False, "error": "缺少 order 参数"}, status_code=400)
    
    async with aiosqlite.connect(DB_PATH) as db:
        # 批量更新 sort_order
        for idx, image_id in enumerate(order):
            await db.execute(
                "UPDATE images SET sort_order = ? WHERE id = ?",
                (idx, image_id)
            )
        await db.commit()
    
    print(f"[{now_bjt()}] 🔄 画廊已重新排序，共 {len(order)} 张图片")
    return JSONResponse({"success": True})


@app.post("/api/import")
async def api_import(file: UploadFile = File(...)):
    """导入外部图片到画廊"""
    from PIL import Image
    import io
    
    # 读取文件内容
    content = await file.read()
    
    # 获取图片尺寸
    try:
        img = Image.open(io.BytesIO(content))
        width, height = img.size
    except Exception:
        return JSONResponse({"success": False, "error": "无法读取图片"}, status_code=400)
    
    # 保存到 output 目录
    ext = Path(file.filename).suffix.lower() or '.png'
    if ext not in ('.png', '.jpg', '.jpeg', '.webp'):
        ext = '.png'
    
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{ts}_import_{uuid.uuid4().hex[:6]}{ext}"
    filepath = OUTPUT_DIR / filename
    
    with open(filepath, 'wb') as f:
        f.write(content)
    
    # 获取下一个 sort_order
    sort_order = await get_next_sort_order()
    
    # 写入数据库
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO images (job_id, filename, prompt, seed, image_size, width, height, steps, api_url, status, created_at, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            f"import_{uuid.uuid4().hex[:8]}",
            filename,
            "(导入图片)",
            0,
            "custom",
            width,
            height,
            0,
            "",
            "imported",
            now_bjt(),
            sort_order
        ))
        last_id = (await db.execute("SELECT last_insert_rowid()")).fetchone()
        await db.commit()
        
        # 获取插入的记录
        cursor = await db.execute("SELECT * FROM images WHERE filename = ?", (filename,))
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM images WHERE filename = ?", (filename,))
        row = await cursor.fetchone()
        record = dict(row) if row else None
    
    print(f"[{now_bjt()}] 📥 图片已导入: {filename} ({width}x{height})")
    
    return JSONResponse({
        "success": True,
        "data": record
    })


@app.delete("/api/images/{image_id}")
async def api_delete_image(image_id: int):
    await delete_image_record(image_id)
    return JSONResponse({"success": True})


@app.delete("/api/images")
async def api_clear_all():
    await clear_all_records()
    return JSONResponse({"success": True})


# ============ main ============

def main():
    print(f"\n{'='*60}")
    print(f"🎨 HunyuanImage API 测试工具")
    print(f"✅ http://localhost:{PORT}")
    print(f"{'='*60}\n")
    uvicorn.run(app, host="0.0.0.0", port=PORT, access_log=False)

if __name__ == "__main__":
    main()
