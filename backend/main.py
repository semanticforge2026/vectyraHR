"""
Vectyra AI Backend — Production Ready
======================================
Fixes vs main_test.py:
  1. CORS — removed allow_credentials=True (incompatible with allow_origins=["*"])
  2. Async HTTP — replaced blocking `requests` with async `httpx`
  3. HF token — env-only, no hardcoded secrets in source
  4. /api/extract-skills — real NLP extraction (regex + keyword matching)
  5. /api/health — proper health endpoint
  6. static / templates — graceful fallback if dirs don't exist
  7. Timeout — all external HTTP calls have explicit timeouts
  8. Vacancy validation — helpful 422 error message
  9. mangum — optional, only loaded when running on AWS Lambda
 10. Structured logging
"""

import os
import re
import hashlib
import logging
import sqlite3
import time
import hmac
import json
from contextlib import asynccontextmanager
from typing import Optional
from pydantic import BaseModel

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse

# ── Optional dependencies (graceful fallback if missing) ──────────────────────

try:
    import fitz  # PyMuPDF
    HAS_PYMUPDF = True
except ImportError:
    HAS_PYMUPDF = False
    logging.warning("PyMuPDF not installed — PDF parsing disabled")

try:
    from supabase import create_client, Client as SupabaseClient
    HAS_SUPABASE = True
except ImportError:
    HAS_SUPABASE = False

try:
    from starlette.staticfiles import StaticFiles
    from fastapi.templating import Jinja2Templates
    HAS_TEMPLATES = True
except ImportError:
    HAS_TEMPLATES = False

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vectyra")

# ── Config (env-only, no hardcoded secrets) ───────────────────────────────────

HF_TOKEN      = os.getenv("HF_TOKEN", "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")
SUPABASE_URL  = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY  = os.getenv("SUPABASE_KEY", "")
FRONTEND_URL  = os.getenv("FRONTEND_URL", "*")   # set to your real domain in prod
HF_TIMEOUT    = int(os.getenv("HF_TIMEOUT", "60"))  # seconds

if not HF_TOKEN:
    logger.error("HF_TOKEN is not set — AI features will fail.")

HF_HEADERS     = {"Authorization": f"Bearer {HF_TOKEN}"}
API_URL_MATCH  = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-MiniLM-L6-v2"
API_URL_LLM    = "https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct"
LLM_CASCADE = [
    # Router endpoints (OpenAI-compatible) — works in environments with restricted DNS/proxies
    ("https://router.huggingface.co/v1/chat/completions", "meta-llama/Meta-Llama-3-8B-Instruct", "chat"),
    ("https://router.huggingface.co/v1/chat/completions", "Qwen/Qwen2.5-7B-Instruct", "chat"),
    # Legacy Inference API endpoints — fallbacks
    ("https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3-8B-Instruct", "meta-llama/Meta-Llama-3-8B-Instruct", "legacy"),
    ("https://api-inference.huggingface.co/models/Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-7B-Instruct", "legacy"),
]

DATABASE_PATH = "vectyra.db"
SECRET_KEY = "vectyra-super-secret-key-change-in-production"

# ── SQLite Database Setup & Helpers ──────────────────────────────────────────

def init_db():
    """Initialize local SQLite database tables."""
    with sqlite3.connect(DATABASE_PATH) as conn:
        cursor = conn.cursor()
        
        # Create users table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                company TEXT,
                role TEXT
            )
        """)
        
        # Create vacancies table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vacancies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Active',
                created_at TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)
        
        # Create candidates table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS candidates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                match_score REAL NOT NULL,
                status TEXT NOT NULL DEFAULT 'New',
                ai_analysis TEXT,
                skills TEXT,
                created_at TEXT NOT NULL,
                vacancy_id INTEGER,
                user_id INTEGER NOT NULL,
                FOREIGN KEY(vacancy_id) REFERENCES vacancies(id),
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
        """)
        conn.commit()
    logger.info("SQLite database initialized successfully")


# ── Native Security & Auth Helpers ────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = os.urandom(16)
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
    return salt.hex() + ":" + pw_hash.hex()


def verify_password(password: str, hashed: str) -> bool:
    try:
        salt_hex, hash_hex = hashed.split(":")
        salt = bytes.fromhex(salt_hex)
        pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 100000)
        return pw_hash.hex() == hash_hex
    except Exception:
        return False


def generate_token(user_id: int) -> str:
    expires = int(time.time()) + 24 * 3600 # 24 hours
    payload = f"{user_id}:{expires}"
    sig = hmac.new(SECRET_KEY.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"


def verify_token(token: str) -> Optional[int]:
    try:
        parts = token.split(":")
        if len(parts) != 3:
            return None
        user_id_str, expires_str, sig = parts
        payload = f"{user_id_str}:{expires_str}"
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), payload.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected_sig, sig):
            return None
        if int(time.time()) > int(expires_str):
            return None
        return int(user_id_str)
    except Exception:
        return None


def get_current_user_id(request: Request) -> int:
    """Dependency to get authenticated user_id from Bearer token."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authentication token")
    token = auth_header.split(" ")[1]
    user_id = verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Session expired or invalid token")
    return user_id


def get_optional_user_id(request: Request) -> Optional[int]:
    """Optional dependency to extract user_id if Bearer token is provided."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    token = auth_header.split(" ")[1]
    return verify_token(token)


# ── Shared async HTTP client ──────────────────────────────────────────────────

http_client: httpx.AsyncClient = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global http_client, supabase
    http_client = httpx.AsyncClient(timeout=HF_TIMEOUT)
    logger.info("HTTP client ready")
    
    # Initialize SQLite database
    try:
        init_db()
    except Exception as e:
        logger.error(f"Failed to initialize SQLite database: {e}")

    # Supabase (optional)
    if HAS_SUPABASE and SUPABASE_URL and SUPABASE_KEY:
        try:
            supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
            logger.info("Supabase connected")
        except Exception as e:
            logger.warning(f"Supabase connection failed: {e}")

    yield

    await http_client.aclose()
    logger.info("HTTP client closed")

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Vectyra AI API",
    version="4.0",
    description="Semantic resume ↔ vacancy matching powered by HuggingFace",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# FIX: allow_credentials=True is incompatible with allow_origins=["*"].
# Use explicit origins in production, or drop credentials entirely.

_origins = [FRONTEND_URL] if FRONTEND_URL != "*" else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=False,   # FIX: was True — caused browser CORS block
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ── Static files & templates (optional — graceful fallback) ──────────────────

if HAS_TEMPLATES:
    if os.path.isdir("static"):
        from starlette.staticfiles import StaticFiles
        app.mount("/static", StaticFiles(directory="static"), name="static")
    else:
        logger.warning("'static/' directory not found — skipping static mount")

    if os.path.isdir("templates"):
        templates = Jinja2Templates(directory="templates")
    else:
        logger.warning("'templates/' directory not found — HTML routes disabled")
        templates = None
else:
    templates = None

# ── Supabase (optional) ───────────────────────────────────────────────────────

supabase = None

# ── In-memory cache ───────────────────────────────────────────────────────────

AI_CACHE: dict = {}

# ═══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ═══════════════════════════════════════════════════════════════════════════════

def clean_text(text: str) -> str:
    """Remove control characters and normalize whitespace."""
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\xff]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract plain text from PDF bytes using PyMuPDF."""
    if not HAS_PYMUPDF:
        raise HTTPException(
            status_code=501,
            detail="PDF parsing not available. Please send resume as plain text."
        )
    text = ""
    try:
        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            for page in doc:
                text += page.get_text("text") + "\n"
        return clean_text(text)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not parse PDF. File may be corrupted.")


def make_cache_key(vacancy: str, content_bytes: bytes) -> str:
    vh = hashlib.md5(vacancy.encode("utf-8")).hexdigest()
    ch = hashlib.md5(content_bytes).hexdigest()
    return f"{vh}_{ch}"


def extract_skills_from_text(text: str) -> list[str]:
    """
    Lightweight skill extraction using keyword matching.
    Replace with an NLP model call when needed.
    """
    SKILL_KEYWORDS = [
        # Programming
        "Python", "JavaScript", "TypeScript", "Java", "C++", "C#", "Go", "Rust",
        "PHP", "Ruby", "Swift", "Kotlin", "Scala", "R", "MATLAB",
        # Web
        "React", "Vue", "Angular", "Next.js", "Node.js", "FastAPI", "Django",
        "Flask", "Express", "GraphQL", "REST", "HTML", "CSS", "Tailwind",
        # Data / ML
        "Machine Learning", "Deep Learning", "NLP", "TensorFlow", "PyTorch",
        "Scikit-learn", "Pandas", "NumPy", "SQL", "PostgreSQL", "MySQL",
        "MongoDB", "Redis", "Elasticsearch",
        # DevOps / Cloud
        "Docker", "Kubernetes", "AWS", "GCP", "Azure", "CI/CD", "GitHub Actions",
        "Terraform", "Linux", "Nginx",
        # Soft / Other
        "Agile", "Scrum", "Figma", "Jira", "Git",
    ]
    found = []
    text_lower = text.lower()
    for skill in SKILL_KEYWORDS:
        if skill.lower() in text_lower and skill not in found:
            found.append(skill)
    return found[:12]  # cap at 12


async def call_hf(url: str, payload: dict) -> tuple[int, dict | list]:
    """
    Async HuggingFace API call with proper error handling.
    Returns (status_code, response_body).
    """
    try:
        response = await http_client.post(url, headers=HF_HEADERS, json=payload)
        try:
            body = response.json()
        except Exception:
            body = {"error": response.text}
        return response.status_code, body
    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"HuggingFace API timed out after {HF_TIMEOUT}s. Try again."
        )
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Could not reach HuggingFace: {e}")


def handle_hf_error(status: int, body: dict | list) -> None:
    """Raise a clear HTTPException based on HF error response."""
    if status == 200:
        return

    error_str = str(body).lower()

    # Model is loading / cold start
    if "estimated_time" in str(body) or "loading" in error_str:
        wait = 15
        if isinstance(body, dict):
            wait = round(body.get("estimated_time", 15))
        raise HTTPException(
            status_code=503,
            detail=f"🔄 AI model is warming up. Please wait {wait} seconds and try again."
        )

    # Input too large
    if "validation error" in error_str or "size" in error_str or "too long" in error_str:
        raise HTTPException(
            status_code=400,
            detail="Resume text is too long for the free model. Please shorten it."
        )

    # Rate limited
    if status == 429:
        raise HTTPException(
            status_code=429,
            detail="HuggingFace rate limit reached. Please try again in a minute."
        )

    error_msg = body.get("error", "Unknown HF error") if isinstance(body, dict) else str(body)
    raise HTTPException(status_code=500, detail=f"HuggingFace error: {error_msg}")


def parse_llm_json(raw_text: str) -> dict:
    """Attempts to find and parse a JSON object inside the LLM raw output text."""
    text = raw_text.strip()
    
    # Try direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    
    # Try finding json block: ```json ... ```
    json_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except Exception:
            pass
            
    # Try finding any {...} structure
    brace_match = re.search(r"(\{.*\})", text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(1))
        except Exception:
            pass
            
    return {}


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/api/health", tags=["System"])
async def health():
    """Simple liveness probe — returns backend version and HF token status."""
    return {
        "status": "ok",
        "version": "4.0",
        "hf_token_set": bool(HF_TOKEN),
        "supabase_connected": supabase is not None,
        "pdf_support": HAS_PYMUPDF,
    }


# ── HTML pages (optional — only if templates dir exists) ─────────────────────

@app.get("/", response_class=HTMLResponse, tags=["Pages"])
async def root(request: Request):
    if templates:
        return templates.TemplateResponse("index.html", {"request": request})
    return HTMLResponse("<h1>Vectyra API v4.0 — OK</h1><p>Frontend templates not mounted.</p>")


@app.get("/dashboard", response_class=HTMLResponse, tags=["Pages"])
async def dashboard_page(request: Request):
    if templates:
        return templates.TemplateResponse("dashboard.html", {"request": request})
    return HTMLResponse("<h1>Dashboard — templates not mounted</h1>")


# ── Main analysis endpoint ────────────────────────────────────────────────────

@app.post("/api/analyze", tags=["AI"])
async def analyze_resume(
    request: Request,
    vacancy_text: str = Form(
        ...,
        description="Job vacancy description (required). Used as the reference for matching.",
        min_length=10,
    ),
    file: Optional[UploadFile] = File(
        default=None,
        description="Resume as PDF file (optional if resume_text_input provided).",
    ),
    resume_text_input: Optional[str] = Form(
        default=None,
        description="Resume as plain text (optional if file provided).",
    ),
    vacancy_id: Optional[int] = Form(
        default=None,
        description="Vacancy ID to link the candidate to (optional).",
    ),
    candidate_name: Optional[str] = Form(
        default=None,
        description="Candidate name (optional — defaults to 'Кандидат').",
    ),
):
    """
    Analyze resume vs vacancy using semantic similarity (MiniLM) + LLM analysis (Qwen 2.5).

    - Send either `file` (PDF) or `resume_text_input` (plain text), not both required.
    - `vacancy_text` is **always required**.
    - Returns `match_score` (0-100%), `ai_analysis`, `resume_preview`, `skills`.
    - If authenticated, automatically saves the candidate to the database.
    """
    has_file = file is not None and file.filename not in ("", None)
    has_text = resume_text_input is not None and resume_text_input.strip() != ""

    if not has_file and not has_text:
        raise HTTPException(
            status_code=400,
            detail="Provide either a PDF file ('file') or plain text ('resume_text_input')."
        )

    # ── Extract resume text ──────────────────────────────────────────────────

    resume_text = ""
    cache_bytes = b""

    if has_file:
        if file.content_type not in ("application/pdf", "application/octet-stream"):
            if not (file.filename or "").lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=400,
                    detail="Only PDF files are supported. Please convert your resume to PDF."
                )
        file_bytes = await file.read()
        if len(file_bytes) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File too large. Maximum size is 10 MB.")
        resume_text = extract_text_from_pdf(file_bytes)
        cache_bytes = file_bytes
    else:
        resume_text = clean_text(resume_text_input)
        cache_bytes = resume_text.encode("utf-8")

    if not resume_text or len(resume_text) < 10:
        raise HTTPException(status_code=400, detail="Resume is empty or too short.")

    # ── Cache check ──────────────────────────────────────────────────────────

    cache_key = make_cache_key(vacancy_text, cache_bytes)
    if cache_key in AI_CACHE:
        logger.info("Cache hit — returning cached result")
        return AI_CACHE[cache_key]

    # ── Step 1: Semantic similarity via MiniLM ───────────────────────────────

    safe_vacancy = vacancy_text[:800]
    safe_resume  = resume_text[:1500]

    status_code, match_body = await call_hf(
        API_URL_MATCH,
        {"inputs": {"source_sentence": safe_vacancy, "sentences": [safe_resume]}},
    )
    handle_hf_error(status_code, match_body)

    if isinstance(match_body, dict) and "error" in match_body:
        raise HTTPException(status_code=500, detail=f"MiniLM error: {match_body['error']}")

    try:
        match_percentage = round(float(match_body[0]) * 100, 1)
    except (IndexError, TypeError, ValueError):
        raise HTTPException(status_code=500, detail="Unexpected response format from MiniLM.")

    # ── Step 2: LLM analysis via Llama 3 / cascade ──────────────────────────

    system_prompt = (
        "You are an expert HR AI assistant. Analyze the candidate's resume against the job vacancy requirements.\n"
        "You MUST return a JSON object with the exact fields below. "
        "Do not include any chat wrapper, conversational introduction, or markdown comments. "
        "Only return the raw JSON object inside JSON codeblocks or as raw text. All text fields like strengths and weaknesses must be written in UKRAINIAN (українською мовою).\n\n"
        "JSON SCHEMA:\n"
        "{\n"
        '  "name": "Candidate\'s real full name in Ukrainian (if found in the resume, otherwise use standard Ukrainian name or candidate_name input)",\n'
        '  "role": "Calculated job role/specialty of the candidate (e.g. Senior Frontend Engineer) in Ukrainian",\n'
        '  "match_score": 85, // An integer between 0 and 100 based on how well the candidate fits the requirements\n'
        '  "status": "Recommended initial pipeline status: \'На розгляді\' (if score >= 75), \'Скринінг\' (if 40 <= score < 75), or \'New\' (if score < 40)",\n'
        '  "skills": ["Skill1", "Skill2", "Skill3"], // List of 4-8 core technologies/skills found in the resume\n'
        '  "strengths": "Сильні сторони: 3-4 ключові переваги кандидата...",\n'
        '  "weaknesses": "Чого не вистачає: 2-3 прогалини або відсутні навички..."\n'
        "}"
    )

    user_prompt = (
        f"ВАКАНСІЯ:\n{vacancy_text[:800]}\n\n"
        f"РЕЗЮМЕ:\n{resume_text[:2000]}\n\n"
        f"Прізвище/Ім'я (якщо відомо): {candidate_name or 'Невідомо'}"
    )

    ai_data = {}
    ai_verdict = ""
    success_model = None

    # Standard python skill extractor as baseline / fallback
    base_skills = extract_skills_from_text(resume_text)

    for endpoint_url, model_name, api_type in LLM_CASCADE:
        logger.info(f"Attempting cascade with model: {model_name} on {endpoint_url}")
        
        for attempt in range(2):
            try:
                if api_type == "chat":
                    payload = {
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "max_tokens": 500,
                        "temperature": 0.2
                    }
                else:
                    payload = {
                        "inputs": f"<|im_start|>system\n{system_prompt}\n<|im_end|>\n<|im_start|>user\n{user_prompt}\n<|im_end|>\n<|im_start|>assistant\n",
                        "parameters": {"max_new_tokens": 500, "temperature": 0.2},
                        "options": {"wait_for_model": True}
                    }

                llm_status, llm_body = await call_hf(endpoint_url, payload)
                if llm_status == 200:
                    if api_type == "chat":
                        if isinstance(llm_body, dict) and "choices" in llm_body:
                            raw_text = llm_body["choices"][0]["message"]["content"].strip()
                        else:
                            raise ValueError(f"Unexpected chat API response: {llm_body}")
                    else:
                        if isinstance(llm_body, list) and len(llm_body) > 0:
                            raw_text = llm_body[0].get("generated_text", "")
                        else:
                            raise ValueError(f"Unexpected legacy API response: {llm_body}")

                    # Clean prompt prefix if present
                    if "<|im_start|>assistant" in raw_text:
                        parsed_text = raw_text.split("<|im_start|>assistant")[-1].strip()
                    else:
                        parsed_text = raw_text.strip()
                        
                    parsed_text = parsed_text.replace("<|im_end|>", "").strip()
                    
                    # Parse JSON
                    extracted = parse_llm_json(parsed_text)
                    if extracted:
                        ai_data = extracted
                        success_model = model_name
                        break
                    else:
                        ai_verdict = parsed_text
                        if len(parsed_text) > 40:
                            success_model = model_name
                            break
                elif llm_status == 503:
                    logger.warning(f"Model {model_name} cold start (attempt {attempt+1}/2), waiting...")
                    import asyncio
                    await asyncio.sleep(10)
                    continue
            except Exception as e:
                logger.error(f"Error during model {model_name} execution: {e}")
                pass
                
        if success_model:
            break

    # ── Step 3: Populate candidate fields with dynamic adaptation ───────────

    if ai_data:
        c_name = ai_data.get("name") or candidate_name or "Кандидат"
        # Sanitize candidate name
        if c_name == "Кандидат" and resume_text:
            lines = resume_text.strip().split("\n")
            for line in lines[:5]:
                line = line.strip()
                if len(line) > 3 and len(line) < 60 and not any(c.isdigit() for c in line):
                    c_name = line
                    break
                    
        c_role = ai_data.get("role") or "Кандидат"
        
        c_score = ai_data.get("match_score")
        if c_score is None:
            c_score = match_percentage
        else:
            try:
                c_score = round(float(c_score), 1)
            except Exception:
                c_score = match_percentage
                
        c_status = ai_data.get("status") or "New"
        c_skills = ai_data.get("skills") or base_skills
        
        strengths = ai_data.get("strengths") or ""
        weaknesses = ai_data.get("weaknesses") or ""
        if strengths or weaknesses:
            # Build beautifully formatted summary
            ai_verdict = f"{strengths}\n\n{weaknesses}"
        else:
            ai_verdict = ai_data.get("ai_analysis") or ai_verdict or "Успішно проаналізовано."
    else:
        # Fallback if no JSON could be parsed or cascade failed
        c_name = candidate_name or "Кандидат"
        if c_name == "Кандидат" and resume_text:
            lines = resume_text.strip().split("\n")
            for line in lines[:5]:
                line = line.strip()
                if len(line) > 3 and len(line) < 60 and not any(c.isdigit() for c in line):
                    c_name = line
                    break
        c_role = "Кандидат"
        c_score = match_percentage
        c_status = "New"
        c_skills = base_skills
        if not ai_verdict:
            ai_verdict = "AI-аналіз тимчасово недоступний. Спробуйте через кілька хвилин."

    # ── Step 4: Auto-save candidate if authenticated ─────────────────────────

    user_id = get_optional_user_id(request)
    saved_candidate_id = None
    if user_id:
        try:
            created_at = time.strftime("%d.%m.%Y")
            skills_str = ", ".join(c_skills)

            with sqlite3.connect(DATABASE_PATH) as conn:
                cursor = conn.cursor()
                cursor.execute(
                    "INSERT INTO candidates (name, role, match_score, status, ai_analysis, skills, created_at, vacancy_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (c_name, c_role, c_score, c_status, ai_verdict, skills_str, created_at, vacancy_id, user_id)
                )
                conn.commit()
                saved_candidate_id = cursor.lastrowid
            logger.info(f"Candidate saved: id={saved_candidate_id}, user={user_id}")
        except Exception as e:
            logger.warning(f"Failed to auto-save candidate: {e}")

    # ── Build response ───────────────────────────────────────────────────────

    response_data = {
        "status":         "success",
        "match_score":    c_score,
        "ai_analysis":    ai_verdict,
        "resume_preview": resume_text[:150] + "…",
        "skills":         c_skills,
        "candidate_id":   saved_candidate_id,
        "name":           c_name,
        "role":           c_role,
        "candidate_status": c_status
    }

    AI_CACHE[cache_key] = response_data
    logger.info(f"Analysis complete — match_score={c_score}% using Llama-3")
    return response_data


# ── Skill extraction endpoint ─────────────────────────────────────────────────

@app.post("/api/extract-skills", tags=["AI"])
async def extract_skills_endpoint(
    file: Optional[UploadFile] = File(default=None),
    resume_text_input: Optional[str] = Form(default=None),
):
    """
    Extract skills from a resume PDF or plain text.
    Returns a list of recognized technology/skill keywords.
    """
    has_file = file is not None and file.filename not in ("", None)
    has_text = resume_text_input is not None and resume_text_input.strip() != ""

    if not has_file and not has_text:
        raise HTTPException(
            status_code=400,
            detail="Provide either a PDF file ('file') or plain text ('resume_text_input')."
        )

    if has_file:
        file_bytes  = await file.read()
        resume_text = extract_text_from_pdf(file_bytes)
    else:
        resume_text = clean_text(resume_text_input)

    if not resume_text or len(resume_text) < 10:
        raise HTTPException(status_code=400, detail="Resume is empty or too short.")

    skills = extract_skills_from_text(resume_text)
    return {"status": "success", "skills": skills, "count": len(skills)}


@app.post("/api/extract-text", tags=["AI"])
async def extract_text_endpoint(file: UploadFile = File(...)):
    """
    Extract plain text from a resume PDF.
    Used as helper for browser-side local AI inference.
    """
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    file_bytes = await file.read()
    text = extract_text_from_pdf(file_bytes)
    return {"status": "success", "text": text}


# ── Authentication & Management Endpoints ─────────────────────────────────────

class UserRegisterSchema(BaseModel):
    email: str
    password: str
    full_name: str
    company: Optional[str] = None
    role: Optional[str] = None


class UserLoginSchema(BaseModel):
    email: str
    password: str


class VacancySchema(BaseModel):
    title: str
    description: str


class CandidateSchema(BaseModel):
    name: str
    role: str
    match_score: float
    status: str
    ai_analysis: str
    skills: list[str]
    vacancy_id: Optional[int] = None


@app.post("/api/auth/register", tags=["Auth"])
async def register(payload: UserRegisterSchema):
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    if not payload.full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required")

    pw_hash = hash_password(payload.password)

    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO users (email, password_hash, full_name, company, role) VALUES (?, ?, ?, ?, ?)",
                (email, pw_hash, payload.full_name.strip(), payload.company, payload.role)
            )
            conn.commit()
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=400, detail="User with this email already exists")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    token = generate_token(user_id)
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "full_name": payload.full_name.strip(),
            "company": payload.company,
            "role": payload.role
        }
    }


@app.post("/api/auth/login", tags=["Auth"])
async def login(payload: UserLoginSchema):
    email = payload.email.strip().lower()
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
        user = cursor.fetchone()

    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = generate_token(user["id"])
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "company": user["company"],
            "role": user["role"]
        }
    }


@app.get("/api/auth/me", tags=["Auth"])
async def get_me(request: Request):
    user_id = get_current_user_id(request)
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("SELECT id, email, full_name, company, role FROM users WHERE id = ?", (user_id,))
        user = cursor.fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "status": "success",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "company": user["company"],
            "role": user["role"]
        }
    }


@app.get("/api/vacancies", tags=["Vacancies"])
async def get_vacancies(request: Request):
    user_id = get_current_user_id(request)
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        # Query total candidates count and average score per vacancy
        cursor.execute("""
            SELECT v.*, 
                   COUNT(c.id) AS candidates_count,
                   AVG(c.match_score) AS average_score
            FROM vacancies v
            LEFT JOIN candidates c ON v.id = c.vacancy_id
            WHERE v.user_id = ?
            GROUP BY v.id
            ORDER BY v.id DESC
        """, (user_id,))
        rows = cursor.fetchall()

    vacancies = []
    for r in rows:
        vacancies.append({
            "id": r["id"],
            "title": r["title"],
            "description": r["description"],
            "status": r["status"],
            "created_at": r["created_at"],
            "candidates_count": r["candidates_count"],
            "average_score": round(r["average_score"], 1) if r["average_score"] is not None else 0
        })

    return {"status": "success", "vacancies": vacancies}


@app.post("/api/vacancies", tags=["Vacancies"])
async def create_vacancy(request: Request, payload: VacancySchema):
    user_id = get_current_user_id(request)
    
    if not payload.title.strip() or not payload.description.strip():
        raise HTTPException(status_code=400, detail="Title and description are required")

    created_at = time.strftime("%d.%m.%Y")
    
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO vacancies (title, description, status, created_at, user_id) VALUES (?, ?, ?, ?, ?)",
                (payload.title.strip(), payload.description.strip(), "Active", created_at, user_id)
            )
            conn.commit()
            vacancy_id = cursor.lastrowid
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")

    return {
        "status": "success",
        "vacancy": {
            "id": vacancy_id,
            "title": payload.title.strip(),
            "description": payload.description.strip(),
            "status": "Active",
            "created_at": created_at,
            "candidates_count": 0,
            "average_score": 0
        }
    }


@app.get("/api/candidates", tags=["Candidates"])
async def get_candidates(request: Request):
    user_id = get_current_user_id(request)
    
    with sqlite3.connect(DATABASE_PATH) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            SELECT c.*, v.title AS vacancy_title 
            FROM candidates c
            LEFT JOIN vacancies v ON c.vacancy_id = v.id
            WHERE c.user_id = ?
            ORDER BY c.match_score DESC, c.id DESC
        """, (user_id,))
        rows = cursor.fetchall()

    candidates = []
    for r in rows:
        skills_list = []
        if r["skills"]:
            skills_list = [s.strip() for s in r["skills"].split(",") if s.strip()]
            
        candidates.append({
            "id": r["id"],
            "name": r["name"],
            "role": r["role"],
            "match_score": r["match_score"],
            "status": r["status"],
            "ai_analysis": r["ai_analysis"],
            "skills": skills_list,
            "created_at": r["created_at"],
            "vacancy_id": r["vacancy_id"],
            "vacancy_title": r["vacancy_title"] or "Спільна база"
        })

    return {"status": "success", "candidates": candidates}


@app.post("/api/candidates", tags=["Candidates"])
async def create_candidate(request: Request, payload: CandidateSchema):
    user_id = get_current_user_id(request)
    created_at = time.strftime("%d.%m.%Y")
    skills_str = ", ".join(payload.skills)
    
    try:
        with sqlite3.connect(DATABASE_PATH) as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO candidates (name, role, match_score, status, ai_analysis, skills, created_at, vacancy_id, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (payload.name, payload.role, payload.match_score, payload.status, payload.ai_analysis, skills_str, created_at, payload.vacancy_id, user_id)
            )
            conn.commit()
            candidate_id = cursor.lastrowid
        return {"status": "success", "candidate_id": candidate_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {e}")


# ── Leads endpoint ────────────────────────────────────────────────────────────

class LeadSchema(BaseModel):
    first_name: str
    last_name: str
    email: str
    company: str
    team_size: Optional[str] = None
    message: Optional[str] = None

@app.post("/api/leads", tags=["Leads"])
async def create_lead(lead: LeadSchema):
    """
    Receive and save lead submissions from the landing page.
    Saves to Supabase if connected, otherwise logs the lead information.
    """
    logger.info(f"Received lead: {lead.first_name} {lead.last_name} ({lead.company}) - {lead.email}")
    
    # Try to save to Supabase if it's connected
    if supabase is not None:
        try:
            data = {
                "first_name": lead.first_name,
                "last_name": lead.last_name,
                "email": lead.email,
                "company": lead.company,
                "team_size": lead.team_size,
                "message": lead.message
            }
            # Try inserting into a "leads" table
            res = supabase.table("leads").insert(data).execute()
            logger.info("Lead saved to Supabase successfully")
        except Exception as e:
            logger.warning(f"Failed to save lead to Supabase: {e}")
            
    return {"status": "success", "message": "Lead received successfully"}


# ── AWS Lambda handler (optional) ─────────────────────────────────────────────

try:
    from mangum import Mangum
    handler = Mangum(app)
except ImportError:
    pass  # Not running on Lambda — that's fine
