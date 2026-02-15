const normalizeUserTypeValue = (value) => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw === "user" || raw === "profile" || raw === "person") return "";
  if (
    raw.includes("community") ||
    raw.includes("club") ||
    raw.includes("society") ||
    raw.includes("organization") ||
    raw.includes("org") ||
    raw.includes("group")
  ) {
    return "community";
  }
  if (raw.includes("alumni")) return "alumni";
  if (
    raw.includes("student") ||
    raw.includes("undergrad") ||
    raw.includes("postgrad") ||
    raw.includes("postgraduate") ||
    raw.includes("graduate") ||
    raw.includes("grad")
  ) {
    return "student";
  }
  return raw;
};

export const resolveStudentType = (user) => {
  return (
    user?.studentType ||
    user?.student_type ||
    user?.educationType ||
    user?.education_type ||
    user?.studentLevel ||
    user?.level ||
    user?.role ||
    user?.userType ||
    user?.user_type ||
    user?.accountType ||
    user?.account_type ||
    ""
  );
};

export const formatStudentType = (value) => {
  if (!value) return "Student";
  const raw = String(value).trim();
  if (!raw) return "Student";
  const lower = raw.toLowerCase();
  if (lower.includes("undergrad")) return "Undergraduate";
  if (lower.includes("postgrad") || lower.includes("postgraduate")) return "Postgraduate";
  if (lower.includes("grad")) return "Graduate";
  if (lower.includes("alumni")) return "Alumni";
  if (lower === "student" || lower === "current") return "Student";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const resolveUserType = (user) => {
  const raw =
    user?.userType ||
    user?.user_type ||
    user?.accountType ||
    user?.account_type ||
    user?.role ||
    user?.type ||
    user?.kind ||
    "";
  const normalizedRaw = normalizeUserTypeValue(raw);
  const studentType = resolveStudentType(user);
  const normalizedStudent = normalizeUserTypeValue(studentType);
  if (normalizedRaw === "community" || normalizedStudent === "community") return "community";
  if (user?.communityName || user?.communityType || user?.community_type) return "community";
  if (normalizedRaw === "alumni" || normalizedStudent === "alumni") return "alumni";
  if (normalizedRaw) return normalizedRaw;
  if (normalizedStudent) return normalizedStudent;
  return "student";
};

export const formatUserType = (value) => {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("alumni")) return "Alumni";
  if (raw.includes("community") || raw.includes("club") || raw.includes("society")) {
    return "Community";
  }
  return "Student";
};

export const resolveCollegeName = (user) => {
  const raw =
    user?.collegeTagName ||
    user?.collegeTag?.name ||
    user?.collegeTag?.collegeName ||
    user?.collegeTag?.collegeTagName ||
    user?.collegeTag?.university ||
    user?.collegeTag ||
    user?.college ||
    user?.university ||
    user?.school ||
    user?.campus ||
    user?.collegeName ||
    user?.institution ||
    user?.schoolName ||
    user?.campusName ||
    "";
  if (typeof raw === "string") return raw.trim();
  if (typeof raw === "object" && raw) {
    const nested =
      raw.name ||
      raw.collegeTagName ||
      raw.collegeName ||
      raw.university ||
      raw.college ||
      raw.school ||
      raw.title ||
      raw.value ||
      "";
    return String(nested || "").trim();
  }
  return "";
};

export const resolveUserBio = (user) => {
  return user?.bio || user?.about || user?.headline || "";
};

export const resolveCommunityName = (user) => {
  return (
    user?.communityName ||
    user?.community_name ||
    user?.organizationName ||
    user?.orgName ||
    user?.fullName ||
    user?.displayName ||
    ""
  );
};

export const resolveCommunityType = (user) => {
  return user?.communityType || user?.community_type || user?.organizationType || "";
};

export const formatCommunityType = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower.includes("club")) return "Club";
  if (lower.includes("society")) return "Society";
  if (lower.includes("organization") || lower.includes("org")) return "Student Organization";
  if (lower.includes("event")) return "Event Community";
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
};

export const resolveCommunityDescription = (user) => {
  return (
    user?.communityDescription ||
    user?.community_description ||
    user?.description ||
    user?.about ||
    ""
  );
};

export const resolveMemberCount = (user) => {
  return (
    user?.memberCount ||
    user?.membersCount ||
    user?.member_count ||
    user?.followersCount ||
    user?.followers ||
    0
  );
};

export const isUserAnonymous = (user) => {
  return Boolean(user?.isAnonymous || user?.is_anonymous || user?.anonymous);
};
