#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HunyuanImage-3.0 API 调用客户端
支持 Text-to-Image 和 Image-to-Image
"""

import requests
import json
import base64
import uuid
from pathlib import Path
from typing import Optional, List, Union
from PIL import Image
from datetime import datetime
import io


def log(msg: str):
    """带时间戳的日志"""
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


class HunyuanImageClient:
    """HunyuanImage API 客户端"""
    
    def __init__(self, api_url: str):
        """
        初始化客户端
        
        Args:
            api_url: Gradio 服务地址，例如 "https://deployment-11919-melbkyyv-30000.550w.link"
        """
        self.api_url = api_url.rstrip('/')
        self.session_hash = self._generate_session_hash()
    
    def _generate_session_hash(self) -> str:
        """生成随机 session hash"""
        return ''.join([chr(ord('a') + i % 26) if i % 2 == 0 else str(i % 10) 
                       for i in range(12)])
    
    def upload_file(self, file_path: str) -> dict:
        """
        上传文件到 Gradio 服务器
        
        Args:
            file_path: 本地文件路径
            
        Returns:
            Gradio 文件引用 dict，包含 path, url, orig_name, size, mime_type
        """
        file_path = Path(file_path)
        
        # 判断 mime_type
        suffix = file_path.suffix.lower()
        mime_map = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif'}
        mime_type = mime_map.get(suffix, 'image/png')
        
        log(f"📤 上传文件到 Gradio: {file_path.name}")
        
        with open(file_path, 'rb') as f:
            response = requests.post(
                f"{self.api_url}/gradio_api/upload",
                files={"files": (file_path.name, f, mime_type)},
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                timeout=60
            )
            response.raise_for_status()
        
        # Gradio 返回的是一个路径数组
        result = response.json()
        remote_path = result[0] if isinstance(result, list) else result
        
        file_ref = {
            "path": remote_path,
            "url": f"{self.api_url}/gradio_api/file={remote_path}",
            "orig_name": file_path.name,
            "size": file_path.stat().st_size,
            "mime_type": mime_type,
            "meta": {"_type": "gradio.FileData"}
        }
        
        log(f"✅ 上传完成: {remote_path}")
        return file_ref
    
    def generate(
        self,
        prompt: str,
        images: Optional[List[dict]] = None,
        seed: int = 42,
        image_size: str = "auto",
        width: int = 1024,
        height: int = 1024,
        diff_infer_steps: int = 50,
        enable_safety_checker: bool = True,
        save_path: Optional[str] = None
    ) -> tuple[Optional[Image.Image], str]:
        """
        统一生成接口（文生图 / 图生图）
        
        Args:
            prompt: 提示词 / 编辑指令
            images: Gradio 文件引用列表（通过 upload_file 获取），None 则为文生图
            seed: 随机种子
            image_size: 图像尺寸
            width: 宽度
            height: 高度
            diff_infer_steps: 推理步数
            enable_safety_checker: 安全检查
            save_path: 保存路径
            
        Returns:
            (生成的图像, 生成信息)
        """
        # 每次生成使用独立的 session_hash，避免并发冲突
        session_hash = self._generate_session_hash()
        
        # API 只接受 "auto" 或 "custom"，宽高通过单独参数传递
        payload = {
            "data": [
                prompt,
                images,           # None = 文生图, List[dict] = 图生图
                seed,
                image_size,       # "auto" 或 "custom"
                width,
                height,
                diff_infer_steps,
                enable_safety_checker
            ],
            "fn_index": 1,
            "trigger_id": int(str(uuid.uuid4().int)[:8]),
            "session_hash": session_hash
        }
        
        mode = "图生图" if images else "文生图"
        log(f"📝 [{mode}] {prompt}")
        if images:
            log(f"🖼️ 参考图: {len(images)} 张")
        log(f"🎲 Seed: {seed}, 📐 Size: {image_size} ({width}x{height}), 🔄 Steps: {diff_infer_steps}")
        
        try:
            response = requests.post(
                f"{self.api_url}/gradio_api/queue/join",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                timeout=30
            )
            response.raise_for_status()
            
            log(f"✅ 已加入队列 (session: {session_hash[:8]}...)")
            
            result = self._get_sse_result(session_hash=session_hash)
            
            if result and len(result) >= 1:
                image_data = result[0]
                info_text = result[1] if len(result) >= 2 else "生成成功"
                
                image = self._parse_image(image_data)
                
                if save_path and image:
                    image.save(save_path)
                    log(f"✅ 图像已保存到: {save_path}")
                
                return image, info_text
            else:
                raise Exception("返回数据格式错误")
                
        except Exception as e:
            log(f"❌ 请求失败: {e}")
            raise
    
    def text_to_image(
        self,
        prompt: str,
        seed: int = 42,
        image_size: str = "auto",
        width: int = 1024,
        height: int = 1024,
        diff_infer_steps: int = 50,
        enable_safety_checker: bool = False,
        save_path: Optional[str] = None
    ) -> tuple[Optional[Image.Image], str]:
        """
        文生图
        
        Args:
            prompt: 提示词
            seed: 随机种子
            image_size: 图像尺寸，可选 "auto", "1024x1024", "1280x768", "768x1280", "16:9", "9:16"
            width: 图像宽度
            height: 图像高度
            diff_infer_steps: 推理步数，Distil 模型推荐 8 步
            enable_safety_checker: 是否启用安全检查
            save_path: 保存路径，不指定则不保存
            
        Returns:
            (生成的图像, 生成信息)
        """
        # 每次生成使用独立的 session_hash
        session_hash = self._generate_session_hash()
        
        # 根据浏览器抓包的数据格式
        payload = {
            "data": [
                prompt,           # 提示词
                None,            # image (文生图为 None)
                seed,            # 随机种子
                image_size,      # "auto" 或 "1280x720" 等
                width,           # 宽度
                height,          # 高度
                diff_infer_steps,  # 推理步数
                enable_safety_checker  # 安全检查
            ],
            "fn_index": 1,  # 根据抓包数据
            "trigger_id": int(str(uuid.uuid4().int)[:8]),
            "session_hash": session_hash
        }
        
        log(f"📝 发送请求: {prompt}")
        log(f"🎲 Seed: {seed}, 📐 Size: {image_size}, 🔄 Steps: {diff_infer_steps}")
        
        try:
            # 1. 加入队列
            response = requests.post(
                f"{self.api_url}/gradio_api/queue/join",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                timeout=30
            )
            response.raise_for_status()
            
            log(f"✅ 已加入队列 (session: {session_hash[:8]}...)")
            
            # 2. 通过 SSE 获取结果
            result = self._get_sse_result(session_hash=session_hash)
            
            if result and len(result) >= 1:
                image_data = result[0]
                info_text = result[1] if len(result) >= 2 else "生成成功"
                
                # 解析图像
                image = self._parse_image(image_data)
                
                # 保存图像
                if save_path and image:
                    image.save(save_path)
                    log(f"✅ 图像已保存到: {save_path}")
                
                return image, info_text
            else:
                raise Exception("返回数据格式错误")
                
        except Exception as e:
            log(f"❌ 请求失败: {e}")
            raise
    
    def image_to_image(
        self,
        prompt: str,
        input_images: Union[str, List[str]],
        seed: int = 42,
        image_size: str = "auto",
        width: int = 1024,
        height: int = 1024,
        diff_infer_steps: int = 50,
        enable_safety_checker: bool = False,
        save_path: Optional[str] = None
    ) -> tuple[Optional[Image.Image], str]:
        """
        图生图
        
        Args:
            prompt: 编辑指令
            input_images: 输入图片路径，单张或多张
            seed: 随机种子
            image_size: 图像尺寸
            width: 图像宽度
            height: 图像高度
            diff_infer_steps: 推理步数
            enable_safety_checker: 是否启用安全检查
            save_path: 保存路径
            
        Returns:
            (生成的图像, 生成信息)
        """
        # 处理输入图片
        if isinstance(input_images, str):
            input_images = [input_images]
        
        # 读取并编码图片 - 使用 Gradio 的文件格式
        image_file = None
        if input_images:
            img_path = input_images[0]  # 目前只支持单张
            image_file = {
                "path": img_path,
                "url": None,
                "size": Path(img_path).stat().st_size,
                "orig_name": Path(img_path).name,
                "mime_type": "image/png"
            }
        
        # 每次生成使用独立的 session_hash
        session_hash = self._generate_session_hash()
        
        payload = {
            "data": [
                prompt,
                image_file,
                seed,
                image_size,       # "auto" 或 "1280x720" 等
                width,
                height,
                diff_infer_steps,
                enable_safety_checker
            ],
            "fn_index": 1,
            "trigger_id": int(str(uuid.uuid4().int)[:8]),
            "session_hash": session_hash
        }
        
        log(f"📝 发送请求: {prompt}")
        log(f"🖼️ 输入图片: {len(input_images)} 张")
        log(f"🎲 Seed: {seed}, 📐 Size: {image_size}, 🔄 Steps: {diff_infer_steps}")
        
        try:
            # 1. 加入队列
            response = requests.post(
                f"{self.api_url}/gradio_api/queue/join",
                json=payload,
                headers={
                    "Content-Type": "application/json",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                timeout=30
            )
            response.raise_for_status()
            
            log(f"✅ 已加入队列 (session: {session_hash[:8]}...)")
            
            # 2. 通过 SSE 获取结果
            result = self._get_sse_result(session_hash=session_hash)
            
            if result and len(result) >= 1:
                image_data = result[0]
                info_text = result[1] if len(result) >= 2 else "生成成功"
                
                # 解析图像
                image = self._parse_image(image_data)
                
                # 保存图像
                if save_path and image:
                    image.save(save_path)
                    log(f"✅ 图像已保存到: {save_path}")
                
                return image, info_text
            else:
                raise Exception("返回数据格式错误")
                
        except Exception as e:
            log(f"❌ 请求失败: {e}")
            raise
    
    def _get_sse_result(self, session_hash: str = None, timeout: int = 300):
        """通过 SSE 获取结果"""
        session = session_hash or self.session_hash
        url = f"{self.api_url}/gradio_api/queue/data?session_hash={session}"
        
        log(f"🔄 等待生成结果...")
        
        try:
            response = requests.get(
                url,
                headers={
                    "Accept": "text/event-stream",
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
                },
                stream=True,
                timeout=timeout
            )
            response.raise_for_status()
            
            # 解析 SSE 流
            try:
                for line in response.iter_lines():
                    if line:
                        line = line.decode('utf-8')
                        
                        # SSE 格式: data: {...}
                        if line.startswith('data: '):
                            data_str = line[6:]  # 去掉 "data: " 前缀
                            
                            try:
                                data = json.loads(data_str)
                                
                                # 打印进度信息
                                if data.get("msg") == "process_generating":
                                    log(f"⏳ 生成中...")
                                elif data.get("msg") == "process_completed":
                                    log(f"✅ 生成完成!")
                                    output = data.get("output", {})
                                    log(f"📦 output keys: {output.keys() if isinstance(output, dict) else type(output)}")
                                    if "data" in output:
                                        return output["data"]
                                    # 兼容其他可能的数据结构
                                    if output:
                                        log(f"📦 output 完整内容: {str(output)[:500]}")
                                        return output
                                elif data.get("msg") == "estimation":
                                    rank = data.get("rank")
                                    queue_size = data.get("queue_size")
                                    log(f"📊 队列位置: {rank}/{queue_size}")
                                
                            except json.JSONDecodeError:
                                continue
            except Exception as iter_error:
                # 连接在获取结果后正常关闭，忽略 ChunkedEncodingError 等错误
                error_msg = str(iter_error)
                if "InvalidChunkLength" in error_msg or "ChunkedEncodingError" in error_msg:
                    # 这是正常的连接关闭，不需要打印错误
                    pass
                else:
                    # 其他错误才打印
                    log(f"⚠️  SSE 流读取中断: {iter_error}")
            
            raise Exception("未获取到结果")
            
        except Exception as e:
            log(f"❌ SSE 连接失败: {e}")
            raise
    
    def _parse_image(self, image_data) -> Optional[Image.Image]:
        """解析图像数据"""
        try:
            if isinstance(image_data, dict):
                # Gradio 返回的文件格式
                if "path" in image_data:
                    # 文件路径格式，需要下载
                    file_path = image_data["path"]
                    
                    # 尝试多种 URL 格式（按优先级排序）
                    urls_to_try = [
                        f"{self.api_url}/gradio_api/file={file_path}",  # Gradio 标准路径
                        image_data.get("url", ""),
                        f"{self.api_url}/file={file_path}",
                        f"{self.api_url}/file{file_path}"
                    ]
                    
                    for file_url in urls_to_try:
                        if not file_url:
                            continue
                        
                        try:
                            log(f"📥 尝试下载: {file_url}")
                            response = requests.get(file_url, timeout=30)
                            response.raise_for_status()
                            return Image.open(io.BytesIO(response.content))
                        except Exception as e:
                            log(f"⚠️  下载失败: {e}")
                            continue
                    
                    # 所有 URL 都失败，尝试直接返回路径信息
                    log(f"⚠️  无法下载图像，返回路径: {file_path}")
                    log(f"💡 你可以手动访问: {self.api_url}/file={file_path}")
                    return None
                
                # 如果是 base64 编码
                elif "data" in image_data:
                    img_str = image_data["data"]
                    if img_str.startswith("data:image"):
                        img_str = img_str.split(",")[1]
                    img_bytes = base64.b64decode(img_str)
                    return Image.open(io.BytesIO(img_bytes))
                
                # 如果是 URL
                elif "url" in image_data:
                    response = requests.get(image_data["url"], timeout=30)
                    return Image.open(io.BytesIO(response.content))
            
            elif isinstance(image_data, str):
                # 直接是 base64 字符串
                if image_data.startswith("data:image"):
                    image_data = image_data.split(",")[1]
                img_bytes = base64.b64decode(image_data)
                return Image.open(io.BytesIO(img_bytes))
            
            return None
        except Exception as e:
            log(f"❌ 图像解析失败: {e}")
            import traceback
            traceback.print_exc()
            return None


def main():
    """示例用法"""
    
    # 初始化客户端
    client = HunyuanImageClient("https://deployment-11919-melbkyyv-30000.550w.link")
    
    # 示例 1: 文生图
    print("\n" + "="*60)
    print("示例 1: Text-to-Image")
    print("="*60)
    
    try:
        image, info = client.text_to_image(
            prompt="一个整洁的家庭花园，修剪齐整的草坪，几棵小树，花坛里开着鲜花，小石径通向远处，晴天",
            seed=42,
            image_size="auto",
            width=1024,
            height=1024,
            diff_infer_steps=50,
            save_path="output_t2i.png"
        )
        if image:
            log(f"✅ 生成成功!")
            log(f"📄 生成信息:\n{info}")
            log(f"📐 图像尺寸: {image.size}")
        else:
            log(f"❌ 图像生成失败")
    except Exception as e:
        log(f"❌ 生成失败: {e}")
        import traceback
        traceback.print_exc()
    
    # 示例 2: 图生图
    # print("\n" + "="*60)
    # print("示例 2: Image-to-Image")
    # print("="*60)
    
    # try:
    #     image, info = client.image_to_image(
    #         prompt="Make it more colorful and vibrant",
    #         input_images="input.jpg",  # 替换为你的输入图片路径
    #         seed=42,
    #         image_size="auto",
    #         diff_infer_steps=8,
    #         save_path="output_i2i.png"
    #     )
    #     log(f"✅ 生成成功!")
    #     log(f"📄 生成信息:\n{info}")
    # except Exception as e:
    #     log(f"❌ 生成失败: {e}")


if __name__ == "__main__":
    main()
