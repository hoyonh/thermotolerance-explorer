# Reference AUCnorm per genotype, computed the way the manuscript scripts do it (scripts/common/load_phenotype_data.R and
# auc_norm_from_means() in plot_functions.R): plates with total >= 15 and not noted "10 total", standard configuration,
# 20 C, OP50, hours 2-3.5; mean plate survival per hour, trapezoid over 2-3.5 h divided by 1.5 h.
# Usage: INPUT=<thermotolerance.csv> OUT=<result.csv> Rscript --vanilla tools/ref_manuscript_auc.R
suppressMessages(library(dplyr))
auc_trapz <- function(t,y) sum(diff(t)*(head(y,-1)+tail(y,-1))/2)
auc_norm <- function(sub){ p<-sub$alive/(sub$alive+sub$dead); m<-tapply(p,sub$hours,mean,na.rm=TRUE); t<-as.numeric(names(m)); o<-order(t); auc_trapz(t[o],as.numeric(m)[o]*100)/(max(t)-min(t)) }
d <- read.csv(Sys.getenv("INPUT"))
d$total <- d$alive+d$dead+d$suicide+d$Rup+d$missing
d <- d[d$total>=15 & d$note!="10 total",]
d <- d[d$config=="standard" & d$culture=="20°C" & d$bacteria=="OP50" & d$hours %in% c(2,2.5,3,3.5),]
res <- do.call(rbind, lapply(split(d,d$genotype), function(s) data.frame(genotype=s$genotype[1], n=nrow(s), hours=length(unique(s$hours)), aucnorm=auc_norm(s))))
write.csv(res, Sys.getenv("OUT"), row.names=FALSE); print(nrow(res))
