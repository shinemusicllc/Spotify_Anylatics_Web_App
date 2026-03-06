# SpotiCheck Backend

## Yêu cầu

- Python 3.12+
- PostgreSQL 15+

## Cài đặt

```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
pip install -r requirements.txt
playwright install chromium
```

## Cấu hình

Copy `.env.example` → `.env` và điền thông tin:

```bash
cp .env.example .env
```

## Chạy

```bash
# Development
uvicorn app.main:app --reload --port 8000

# Production
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## API Docs

Sau khi chạy, mở [http://localhost:8000/docs](http://localhost:8000/docs) để xem Swagger UI.
