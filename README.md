# BTC·ETH Futures Chart

바이낸스 USDⓈ-M 선물 BTCUSDT / ETHUSDT 전용 차트 앱 (바이낸스 UI 스타일).

웹 배포: `main` 브랜치에 병합되면 GitHub Pages로 자동 배포됩니다 (저장소 Settings → Pages → Source를 **GitHub Actions**로 한 번만 설정).

로컬 실행: `python3 -m http.server 8000` 후 http://localhost:8000 접속 (빌드 불필요, 정적 파일).

- 캔들 + 거래량, 1m~1W 타임프레임, MA/EMA/BOLL/VOL 지표
- 24h 티커, 마크/인덱스 가격, 펀딩비·카운트다운
- 실시간 호가창, 최근 체결 (Binance Futures 공개 WebSocket)
- 왼쪽 스크롤 시 과거 캔들 자동 로드
- 모바일(768px 이하): 컴팩트 헤더 + 하단 탭바(차트 / 호가창 / 체결) 전용 화면
