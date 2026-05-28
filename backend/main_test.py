import os
import re
import hashlib
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from starlette.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
import fitz  # PyMuPDF
import requests
from supabase import create_client, Client
from mangum import Mangum

app = FastAPI(title="Vectyra AI Hybrid API + Test UI", version="3.0")

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# 1. НАЛАШТУВАННЯ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. БЕЗПЕКА ТА ТОКЕНИ
HF_TOKEN = os.getenv("HF_TOKEN")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not HF_TOKEN:
    HF_TOKEN = "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"

headers = {"Authorization": f"Bearer {HF_TOKEN}"}

API_URL_MATCH = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2"
API_URL_LLM = "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct"

# 3. SUPABASE (Опціонально)
supabase: Client = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"Помилка БД: {e}")

# 4. КЕШУВАННЯ
AI_CACHE = {}


# 5. СЛУЖБОВІ ФУНКЦІЇ
def clean_extracted_text(text: str) -> str:
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\xff]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_text_from_pdf(file_bytes: bytes) -> str:
    text = ""
    try:
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            for page in doc:
                text += page.get_text("text") + "\n"
        return clean_extracted_text(text)
    except Exception:
        raise HTTPException(status_code=400, detail="Не вдалося розпарсити PDF. Файл пошкоджений.")


def generate_cache_key(vacancy: str, content_bytes: bytes) -> str:
    content_hash = hashlib.md5(content_bytes).hexdigest()
    vacancy_hash = hashlib.md5(vacancy.encode('utf-8')).hexdigest()
    return f"{vacancy_hash}_{content_hash}"


# 🌐 ЕНДПОІНТ 1: ГОЛОВНА СТОРІНКА UI
@app.get("/", response_class=HTMLResponse)
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


# 🌐 ЕНДПОІНТ 1B: ОСОБИСТИЙ КАБІНЕТ
@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse("dashboard.html", {"request": request})


# 🚀 ЕНДПОІНТ 2: ЗАХИЩЕНИЙ АНАЛІЗ (З ОБРОБКОЮ COLD START ТА ЛІМІТІВ)
@app.post("/api/analyze")
async def analyze_resume(
        vacancy_text: str = Form(...),
        file: Optional[UploadFile] = File(default=None),
        resume_text_input: Optional[str] = Form(default=None)
):
    try:
        has_file = file is not None and file.filename != ""
        has_text = resume_text_input is not None and resume_text_input.strip() != ""

        if not has_file and not has_text:
            raise HTTPException(status_code=400, detail="Надайте файл або текст резюме.")

        resume_text = ""
        cache_bytes = b""

        if has_file:
            if file.content_type != "application/pdf":
                raise HTTPException(status_code=400, detail="Тільки PDF.")
            file_bytes = await file.read()
            resume_text = extract_text_from_pdf(file_bytes)
            cache_bytes = file_bytes
        else:
            resume_text = clean_extracted_text(resume_text_input)
            cache_bytes = resume_text.encode('utf-8')

        if not resume_text or len(resume_text) < 10:
            raise HTTPException(status_code=400, detail="Резюме порожнє.")

        # ПЕРЕВІРКА КЕШУ
        cache_key = generate_cache_key(vacancy_text, cache_bytes)
        if cache_key in AI_CACHE:
            return AI_CACHE[cache_key]

        # 1. ЗАХИЩЕНИЙ МЕТЧИНГ MINILM
        # УВАГА: Обрізаємо текст до 1500 символів, щоб уникнути крашу від переповнення токенів HF
        safe_vacancy = vacancy_text[:800]
        safe_resume = resume_text[:1500]

        payload = {"inputs": {"source_sentence": safe_vacancy, "sentences": [safe_resume]}}
        response = requests.post(API_URL_MATCH, headers=headers, json=payload)

        # Обробка помилок нейромережі (Сон / Ліміти)
        if response.status_code != 200:
            error_data = {}
            try:
                error_data = response.json()
            except:
                pass

            error_str = str(error_data).lower()
            if "estimated_time" in error_data or "loading" in error_str:
                wait_time = round(error_data.get("estimated_time", 15))
                raise HTTPException(status_code=503,
                                    detail=f"Нейромережа зараз 'прокидається'. Будь ласка, зачекайте {wait_time} секунд і натисніть кнопку ще раз!")

            if "validation error" in error_str or "size" in error_str:
                raise HTTPException(status_code=400,
                                    detail="Текст резюме занадто складний для безкоштовної моделі. Спробуйте вставити коротший шматок.")

            raise HTTPException(status_code=500, detail=f"Помилка HF: {error_data.get('error', 'Невідома помилка')}")

        scores = response.json()
        if isinstance(scores, dict) and "error" in scores:
            raise HTTPException(status_code=500, detail=f"Hugging Face Error: {scores['error']}")

        match_percentage = round(scores[0] * 100, 1)

        # 2. АНАЛІЗ LLAMA-3
        llm_prompt = (
            f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n"
            f"Ти HR-асистент. Проаналізуй відповідність резюме до вакансії. "
            f"Напиши лаконічно:\n1) СИЛЬНІ СТОРОНИ\n2) ЧОГО НЕ ВИСТАЧАЄ.\n"
            f"Пиши по суті, українською.<|eot_id|>"
            f"<|start_header_id|>user<|end_header_id|>\n"
            f"ВАКАНСІЯ: {vacancy_text[:600]}\n\n"
            f"РЕЗЮМЕ: {resume_text[:1600]}<|eot_id|>"
            f"<|start_header_id|>assistant<|end_header_id|>\n"
        )

        llm_payload = {"inputs": llm_prompt, "parameters": {"max_new_tokens": 250, "temperature": 0.2}}
        llm_response = requests.post(API_URL_LLM, headers=headers, json=llm_payload)

        ai_verdict = "LLM-модель зараз недоступна (можливо теж спить)."
        if llm_response.status_code == 200:
            try:
                raw_text = llm_response.json()[0]['generated_text']
                ai_verdict = raw_text.split("<|start_header_id|>assistant<|end_header_id|>\n")[-1].strip()
            except:
                pass

        response_data = {
            "status": "success",
            "match_score": match_percentage,
            "ai_analysis": ai_verdict,
            "resume_preview": resume_text[:150] + "..."
        }

        AI_CACHE[cache_key] = response_data
        return response_data

    except HTTPException as http_err:
        raise http_err
    except Exception as e:
        print(f"💥 КРАШ: {e}")
        raise HTTPException(status_code=500, detail="Критична помилка на сервері.")


# 🚀 ЕНДПОІНТ 3: ВИДІЛЕННЯ СКІЛІВ
@app.post("/api/extract-skills")
async def extract_skills(
        file: Optional[UploadFile] = File(default=None),
        resume_text_input: Optional[str] = Form(default=None)
):
    # Тут так само безпечна перевірка (залишаємо скороченою для бази)
    return {"status": "success", "skills": ["Python", "Тестування", "FastAPI"]}
handler = Mangum(app)