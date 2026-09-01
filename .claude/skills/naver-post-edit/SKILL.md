---
name: naver-post-edit
description: publy-BAP에서 네이버 블로그 "기존 글 편집·덮어쓰기·재발행"(글살리기 editLogNo 등)을 하거나, "로그인ID ≠ 블로그주소(blogId)"(예: 로그인 bb9653 / 블로그 system-b) 문제, 편집 진입이 글목록(PostList)으로 튕기는 증상을 다룰 때 사용. 새로 짜지 말고 검증된 기존 코드를 재사용하도록 안내한다.
---

# 네이버 기존 글 편집·재발행 (검증된 코드 재사용)

퍼블리에서 **네이버 기존 글을 편집/덮어쓰기/재발행**하거나 **로그인ID ≠ 블로그주소** 문제를 만나면,
**절대 편집 URL·에디터 진입 로직을 새로 만들지 말 것.** 이미 실측 검증(2026-08-23, 모든 계정 동작)된 코드가 있다.

## 원본 (그대로 재사용)
- **`neighbor-bot/src/naver.ts` → `updatePostTitle`** : 블로그지수 '제목수정'. 기존 글 편집·재발행이 실제로 되는 원본.
- **`neighbor-bot/src/naver.ts` → `resolveBlogIdFast`** : 로그인ID ≠ blogId 교정.

## 반드시 지킬 규칙 (실측)
1. **편집 URL** = `https://blog.naver.com/PostWriteForm.naver?blogId=${realBlogId}&logNo=${logNo}&Redirect=Update`
   (폴백 `...&Redirect=Update&logNo=${logNo}&categoryNo=0`).
   ❌ `PostUpdateForm.naver`는 **무효** — 네이버가 글목록(`PostList.naver`)으로 튕긴다.
2. **blogId는 실행 시점에 반드시 `resolveBlogIdFast`(naver-bot은 `resolveNaverBlogId`)로 재확정.**
   저장된 blogId가 로그인ID로 잘못 박혀 있으면 편집 URL이 곧장 PostList로 튕긴다. GoBlogWrite 302 Location(1순위)·m.blog MyBlog(2순위)에서 진짜 blogId를 뽑는다.
3. **에디터 컨텍스트 = iframe(mainFrame)이 있으면 그걸, 없으면 '페이지 자체'.**
   최신 스마트에디터 편집모드는 iframe 없이 페이지에 직접 뜬다. 프레임만 찾으면 계속 실패.
   성공 판정 = `.se-section-documentTitle` 요소 존재(URL/프레임 이름으로 판정 금지).
4. **재발행 = 발행과 동일**: 제목칸 교체 → 본문 채움 → `publish_btn` → 확인 버튼.
5. **원본 보존**: 편집기 진입/입력 검증에 실패하면 기존 글을 건드리기 전에 안전하게 에러로 중단.

## 계정 지목 (프론트)
- 발행·원터치·불러오기·글살리기는 전부 **`user.id` 세션**(`naver_${user.id}`)을 쓴다. `username === blogId` 매칭을 **하지 말 것**
  (로그인ID ≠ blogId면 막힌다). 네이버 계정 연결 여부만 확인하고 진행.

## 관련 메모리
`reference_publy_post_edit`, `project_publy_session_0901`, `project_publy_blogdoctor`
